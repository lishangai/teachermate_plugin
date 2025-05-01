// Using a Map to better manage download tasks
const downloadQueue = new Map(); 
let isProcessing = false; // Flag to prevent concurrent processing

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理下载请求
  if (request.type === 'downloadPPT') {
    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    downloadQueue.set(taskId, {
      status: 'pending',
      url: request.url,
      filename: request.filename,
      retries: 0,
      maxRetries: 3
    });
    
    console.log(`添加下载任务: ${taskId}`, request);
    
    if (!isProcessing) {
      processDownloadQueue();
    }
    
    // 立即返回响应
    sendResponse({ success: true, taskId });
    return true;
  }
  
  // 添加: 处理批量下载请求，转发给内容脚本
  if (request.type === 'batchDownload') {
    console.log('收到批量下载请求，准备处理:', request);
    
    // 直接在后台处理下载请求
    try {
      handleDirectDownloads(request.urls);
      // 立即返回响应
      sendResponse({success: true, method: 'direct'});
    } catch (error) {
      console.error('处理下载请求失败:', error);
      sendResponse({success: false, error: error.message});
    }
    
    return true; // 异步响应
  }
  
  return false; // 未处理消息
});

// 注册通知事件监听，当前页面是Office预览页时自动提取URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('view.officeapps.live.com')) {
    console.log('检测到Office预览页面加载完成:', tab.url);
    
    // 向该标签页注入内容脚本（以防内容脚本未自动加载）
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // 检查内容脚本是否已加载
        if (!window.PPT_DOWNLOADER_LOADED) {
          console.log('内容脚本未加载，通知后台直接处理');
          // 通知后台直接处理URL
          chrome.runtime.sendMessage({
            type: 'autoDownload',
            url: window.location.href
          });
        }
      }
    }).catch(err => console.error('注入脚本失败:', err));
  }
});

// 处理自动下载请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'autoDownload' && request.url) {
    console.log('收到自动下载请求:', request.url);
    processUrl(request.url);
    return true;
  }
});

async function processDownloadQueue() {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    for (const [taskId, task] of downloadQueue) {
      if (task.status !== 'pending') continue;
      
      console.log(`处理下载任务: ${taskId}`, task);
      
      try {
        downloadQueue.set(taskId, { ...task, status: 'downloading' });
        
        // 预处理URL
        const processedUrl = await preprocessDownloadUrl(task.url);
        
        // 开始下载
        const downloadId = await chrome.downloads.download({
          url: processedUrl,
          filename: sanitizeFilename(task.filename),
          conflictAction: 'uniquify',
          saveAs: false
        });
        
        console.log(`下载已开始: ${downloadId}`, task);
        
        // 更新任务状态
        downloadQueue.set(taskId, { 
          ...task, 
          status: 'started',
          downloadId 
        });
        
        // 监听下载完成事件
        chrome.downloads.onChanged.addListener(function onChanged(delta) {
          if (delta.id === downloadId) {
            if (delta.state && delta.state.current === 'complete') {
              console.log(`下载完成: ${downloadId}`);
              downloadQueue.delete(taskId);
              chrome.downloads.onChanged.removeListener(onChanged);
            } else if (delta.error) {
              console.error(`下载出错: ${downloadId}`, delta.error);
              handleDownloadError(taskId, task, delta.error.current);
              chrome.downloads.onChanged.removeListener(onChanged);
            }
          }
        });
        
      } catch (error) {
        console.error(`处理下载任务失败: ${taskId}`, error);
        handleDownloadError(taskId, task, error.message);
      }
      
      // 添加间隔，避免并发下载
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } finally {
    isProcessing = false;
    
    // 检查是否还有待处理的任务
    const pendingTasks = Array.from(downloadQueue.values()).filter(t => t.status === 'pending');
    if (pendingTasks.length > 0) {
      setTimeout(processDownloadQueue, 1000);
    }
  }
}

async function preprocessDownloadUrl(url) {
  try {
    // 处理特殊字符
    url = decodeURIComponent(url).replace(/&amp;/g, '&');
    
    // 检查URL是否需要重定向
    const response = await fetch(url, { 
      method: 'HEAD',
      redirect: 'manual'
    });
    
    if (response.status === 301 || response.status === 302) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        console.log('URL重定向:', redirectUrl);
        return redirectUrl;
      }
    }
    
    return url;
  } catch (error) {
    console.error('预处理URL失败:', error);
    return url;
  }
}

function handleDownloadError(taskId, task, errorMessage) {
  if (task.retries < task.maxRetries) {
    // 重试
    downloadQueue.set(taskId, {
      ...task,
      status: 'pending',
      retries: task.retries + 1,
      lastError: errorMessage
    });
    
    console.log(`安排重试下载: ${taskId} (第 ${task.retries + 1} 次)`);
    
    // 延迟重试
    setTimeout(() => {
      if (!isProcessing) {
        processDownloadQueue();
      }
    }, 2000 * (task.retries + 1));
  } else {
    console.error(`下载失败，已达到最大重试次数: ${taskId}`);
    downloadQueue.set(taskId, {
      ...task,
      status: 'failed',
      error: errorMessage
    });
  }
}

function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

// Remove the interval-based retry logic, as retries are now handled within processDownloadQueue
// The periodic check might still be useful for other maintenance or re-triggering stalled queues.
// Adding a simple periodic trigger just in case processing stops unexpectedly.
setInterval(() => {
    console.log('Periodic check: Triggering queue processing if not already active.');
    if (!isProcessing) {
        processDownloadQueue();
    }
}, 60000); // Run every 60 seconds

// Optional: Add listeners for download lifecycle events for better status tracking
/*
chrome.downloads.onChanged.addListener(delta => {
    const taskId = findTaskByDownloadId(delta.id);
    if (!taskId) return;
    const task = downloadQueue.get(taskId);

    if (delta.state && delta.state.current === 'complete') {
        console.log(`Download ${delta.id} completed for task ${taskId}`);
        // Already removed on successful call, but good for confirmation
        downloadQueue.delete(taskId);
    } else if (delta.state && delta.state.current === 'interrupted') {
        console.error(`Download ${delta.id} interrupted for task ${taskId}`);
        // Handle interruption (e.g., retry)
        handleDownloadFailure(taskId, task, 'Interrupted');
    } else if (delta.error) {
         console.error(`Download ${delta.id} failed for task ${taskId}`, delta.error.current);
         handleDownloadFailure(taskId, task, delta.error.current);
    }
});

function findTaskByDownloadId(downloadId) {
    // This requires storing the downloadId with the task when chrome.downloads.download resolves
    // Needs modification in processDownloadQueue to store the ID
    for (const [taskId, task] of downloadQueue.entries()) {
        if (task.downloadId === downloadId) {
            return taskId;
        }
    }
    return null;
}

function handleDownloadFailure(taskId, task, errorMsg) {
   // Similar logic to the catch block in processDownloadQueue for retries
}
*/

// 直接处理下载请求的辅助函数
function handleDirectDownloads(urls) {
  console.log('开始直接处理批量下载，URL数量:', urls.length);
  
  // 为每个URL创建下载任务
  urls.forEach((url, index) => {
    // 简单的延迟处理，避免同时发起太多请求
    setTimeout(() => {
      processUrl(url);
    }, index * 1500); // 每个任务间隔1.5秒
  });
}

// 处理单个URL
async function processUrl(originalUrl) {
  console.log('处理URL:', originalUrl);
  
  try {
    // 1. 修改ssl参数
    let url = originalUrl;
    if (url.includes('ssl=1')) {
      url = url.replace('ssl=1', 'ssl=0');
    }
    console.log('修改后URL:', url);
    
    // 2. 获取重定向URL
    let finalUrl = '';
    try {
      console.log('发送请求获取重定向...');
      const response = await fetch(url, { 
        redirect: 'manual',
        cache: 'no-store' // 禁用缓存
      });
      console.log('请求响应状态:', response.status);
      
      if ([301, 302, 307, 308].includes(response.status)) {
        // 通过重定向响应头获取URL
        finalUrl = response.headers.get('location');
        console.log('获取到重定向URL:', finalUrl);
      } else if (response.status === 200) {
        // 如果服务器直接返回200而不是重定向，尝试从响应文本中提取URL
        console.log('服务器返回200状态码（无重定向），尝试从响应内容中提取URL');
        
        const text = await response.text();
        finalUrl = extractDownloadUrl(text);
        
        if (!finalUrl) {
          console.error('无法从响应内容中提取下载URL');
          throw new Error('无法从响应中提取下载URL');
        }
      } else {
        console.error('服务器返回非预期状态码:', response.status);
        throw new Error(`服务器响应异常 (状态码: ${response.status})`);
      }
    } catch (error) {
      console.error('获取下载URL失败:', error);
      throw error;
    }
    
    // 3. 处理最终URL - 使用优化的URL提取方法
    if (finalUrl) {
      finalUrl = extractDownloadUrl(finalUrl);
    }
    
    // 4. 提取文件名
    let filename = extractFilename(finalUrl);
    
    console.log('最终文件名:', filename);
    console.log('最终下载URL:', finalUrl);
    
    // 5. 添加到下载队列
    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    downloadQueue.set(taskId, {
      status: 'pending',
      url: finalUrl,
      filename: filename,
      retries: 0
    });
    
    console.log(`下载任务创建成功: ${filename}`);
    if (!isProcessing) {
      processDownloadQueue();
    }
  } catch (error) {
    console.error('处理URL失败:', error);
  }
}

// 新增：优化的URL提取函数
function extractDownloadUrl(input) {
  // 先检查输入类型
  const text = typeof input === 'string' ? input : String(input);
  
  try {
    // 1. 优先使用用户建议的策略：查找OSSAccessKeyId参数，然后向前查找https://
    if (text.includes('OSSAccessKeyId')) {
      console.log('发现OSSAccessKeyId参数，使用优化提取策略');
      
      const ossIndex = text.indexOf('?OSSAccessKeyId');
      if (ossIndex > 0) {
        // 向前查找最后一个https://
        const startIndex = text.lastIndexOf('https://', ossIndex);
        
        if (startIndex >= 0) {
          // 提取https://到?OSSAccessKeyId之间的内容
          const extractedUrl = text.substring(startIndex, ossIndex);
          console.log('使用优化策略提取到URL:', extractedUrl);
          return extractedUrl.replace(/%20/g, ' ');
        }
      }
    }
    
    // 2. 如果找不到OSSAccessKeyId参数，或者提取失败，尝试使用正则表达式查找teachermate链接
    const teachermatePattern = /(https:\/\/app\.teachermate\.(?:com\.cn|cn)\/[A-Za-z0-9]+-\d+-[^?&\s"'<>]+)/;
    const teachermateMatch = text.match(teachermatePattern);
    
    if (teachermateMatch) {
      console.log('使用正则表达式提取到teachermate URL:', teachermateMatch[1]);
      return teachermateMatch[1].replace(/%20/g, ' ');
    }
    
    // 3. 如果是URL对象，尝试清理查询参数
    if (text.startsWith('http')) {
      try {
        const urlObj = new URL(text);
        const paramsToRemove = ['OSSAccessKeyId', 'Expires', 'Signature', 'exires', 'accesskeyid', 'signature']; 
        
        paramsToRemove.forEach(param => {
          if (urlObj.searchParams.has(param)) {
            urlObj.searchParams.delete(param);
          }
        });
        
        // 清理空查询字符串
        let cleanedUrl = urlObj.toString();
        if (cleanedUrl.endsWith('?')) {
          cleanedUrl = cleanedUrl.slice(0, -1);
        }
        
        console.log('通过URL对象清理参数后:', cleanedUrl);
        return cleanedUrl.replace(/%20/g, ' ');
      } catch (e) {
        console.warn('URL解析失败:', e);
      }
    }
    
    // 4. 最后的尝试：提取任何看起来像URL的内容
    const anyUrlPattern = /(https?:\/\/[^\s"'<>]+)/;
    const anyUrlMatch = text.match(anyUrlPattern);
    
    if (anyUrlMatch) {
      console.log('使用通用URL提取策略:', anyUrlMatch[1]);
      return anyUrlMatch[1].replace(/%20/g, ' ');
    }
    
    // 如果所有策略都失败，返回原始输入
    console.warn('所有URL提取策略均失败，返回原始输入');
    return text;
  } catch (e) {
    console.error('URL提取过程出错:', e);
    return text;
  }
}

// 新增：优化的文件名提取函数
function extractFilename(url) {
  try {
    // 尝试从URL提取文件名
    const pathParts = url.split('/');
    let lastPart = pathParts[pathParts.length - 1].split('?')[0];
    
    // 尝试从标准格式URL提取文件名
    const filenameMatch = lastPart.match(/[A-Za-z0-9]+-\d+-(.+)/);
    if (filenameMatch && filenameMatch[1]) {
      // 标准格式：提取第三部分作为文件名
      let filename = filenameMatch[1];
      console.log('从标准URL格式提取文件名:', filename);
      
      // 检查扩展名并处理
      return ensureFileExtension(filename);
    }
    
    // 尝试从简化格式URL提取文件名
    const simpleMatch = lastPart.match(/[A-Za-z0-9]+-(\d+)/);
    if (simpleMatch && simpleMatch[1]) {
      // 使用时间戳生成文件名
      const timestamp = parseInt(simpleMatch[1]);
      let filename = '';
      
      if (!isNaN(timestamp)) {
        try {
          const date = new Date(timestamp);
          if (date && date.getFullYear() > 2000) {
            filename = `课件_${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}`;
          } else {
            filename = `课件_${simpleMatch[1]}`;
          }
        } catch (e) {
          filename = `课件_${simpleMatch[1]}`;
        }
      } else {
        filename = lastPart;
      }
      
      // 检查扩展名并处理
      return ensureFileExtension(filename);
    }
    
    // 如果以上尝试均失败，使用最后一段路径作为文件名
    return ensureFileExtension(lastPart);
  } catch (e) {
    console.error('提取文件名时出错:', e);
    return ensureFileExtension(`课件_${Date.now()}`);
  }
}

// 新增：确保文件名有正确的扩展名
function ensureFileExtension(filename) {
  // 检查是否已有扩展名
  if (!filename.includes('.')) {
    // 默认使用pptx扩展名
    filename += '.pptx';
  }
  
  // 清理文件名中的非法字符
  return filename.replace(/[\\/:*?"<>|]/g, '_').substring(0, 200);
}

console.log('Background service worker started.'); 