// Using a Map to better manage download tasks
const downloadQueue = new Map(); 
let isProcessing = false; // Flag to prevent concurrent processing

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理下载请求
  if (request.type === 'downloadPPT') {
    // Generate a more robust unique ID
    const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Basic validation
    if (!request.url || !request.filename) {
        console.error('Invalid download request received:', request);
        // Optionally send a response back to content script indicating failure
        // sendResponse({ status: 'error', message: 'Invalid URL or filename' });
        return false; // Indicate async response won't be sent or message failed
    }

    downloadQueue.set(taskId, {
      status: 'pending',
      url: request.url,
      filename: request.filename,
      retries: 0 // Add retry counter
    });
    
    console.log(`Task ${taskId} added to queue: ${request.filename}`);
    // Trigger processing immediately if not already running
    if (!isProcessing) {
        processDownloadQueue();
    }
    // Indicate that we might send a response asynchronously (though we don't in this specific case)
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

async function processDownloadQueue() {
  if (isProcessing) return; // Prevent multiple concurrent runs
  isProcessing = true;
  console.log('Processing download queue...');

  const tasksToProcess = Array.from(downloadQueue.entries())
                             .filter(([taskId, task]) => task.status === 'pending');

  if (tasksToProcess.length === 0) {
      console.log('Download queue is empty.');
      isProcessing = false;
      return;
  }

  // Process one task at a time to avoid overwhelming the browser or network
  const [taskId, task] = tasksToProcess[0]; 

  try {
    downloadQueue.set(taskId, { ...task, status: 'downloading' });
    console.log(`Attempting download for task ${taskId}: ${task.filename}`);
    
    // Use await with the downloads API (it returns a Promise)
    const downloadId = await chrome.downloads.download({
      url: task.url,
      filename: sanitizeFilename(task.filename), // Sanitize filename
      conflictAction: 'uniquify', // Automatically rename if filename exists
      saveAs: false // Do not prompt user for save location
    });

    if (!downloadId) {
        // If downloadId is undefined, the download failed to start
        throw new Error('chrome.downloads.download did not return a download ID.');
    }
    
    // Monitor download status (optional but good practice)
    // This requires the downloads API event listeners, adding complexity.
    // For simplicity here, we assume success if the API call succeeds.
    // In a production extension, you'd add listeners for onChanged, onDeterminingFilename etc.

    console.log(`Download started for task ${taskId} (Download ID: ${downloadId}): ${task.filename}`);
    downloadQueue.delete(taskId); // Remove successful task from queue

  } catch (error) {
    console.error(`Download failed for task ${taskId} (${task.filename}):`, error);
    const updatedTask = { 
      ...task, 
      status: 'failed',
      error: error.message,
      retries: (task.retries || 0) + 1
    };

    if (updatedTask.retries <= 3) { // Limit retries
        console.log(`Task ${taskId} failed, attempt ${updatedTask.retries}. Will retry.`);
        downloadQueue.set(taskId, { ...updatedTask, status: 'pending' }); // Set back to pending for retry
    } else {
        console.error(`Task ${taskId} failed after ${updatedTask.retries} retries. Giving up.`);
        downloadQueue.set(taskId, updatedTask); // Keep in queue as permanently failed
    }
  }

  // Process next item after a short delay, regardless of success/failure
  setTimeout(() => {
    isProcessing = false;
    processDownloadQueue(); // Trigger next iteration
  }, 500); // Short delay between downloads
}

function sanitizeFilename(name) {
  // More robust sanitization
  // Remove control characters, reserved characters, leading/trailing dots/spaces
  let sanitized = name
    .replace(/[\/\:*?"<>|\x00-\x1F]/g, '_') // Replace reserved chars and control chars with underscore
    .replace(/^\.+|\.+$|^\s+|\s+$/g, '') // Trim leading/trailing dots and whitespace
    .replace(/\.+/g, '.'); // Replace multiple dots with single dot
    
  // Ensure filename is not empty after sanitization
  sanitized = sanitized || 'downloaded_file'; 

  // Truncate if too long (considering potential uniquify additions by browser)
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    const extensionMatch = sanitized.match(/(\.[^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : '';
    const nameWithoutExt = sanitized.substring(0, sanitized.length - extension.length);
    sanitized = nameWithoutExt.substring(0, maxLength - extension.length) + extension;
  }
  return sanitized;
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
        
        // 使用新方法：先查找OSSAccessKeyId参数，再向前找https://
        if (text.includes('OSSAccessKeyId')) {
          console.log('在响应文本中发现OSSAccessKeyId参数');
          
          // 获取OSSAccessKeyId参数的位置
          const ossIndex = text.indexOf('?OSSAccessKeyId');
          if (ossIndex > 0) {
            // 向前查找最后一个https://
            const startIndex = text.lastIndexOf('https://', ossIndex);
            
            if (startIndex >= 0) {
              // 提取https://到?OSSAccessKeyId之间的内容
              finalUrl = text.substring(startIndex, ossIndex);
              console.log('从响应文本中提取到的下载链接:', finalUrl);
            } else {
              console.log('无法找到https://前缀，尝试使用其他方法');
              // 继续使用其他方法
            }
          }
        }
        
        // 如果上面的方法未能提取到URL，则尝试使用正则表达式
        if (!finalUrl) {
          // 修改正则表达式，确保提取完整URL（包括查询参数）
          const urlMatch = text.match(/https:\/\/app\.teachermate\.(?:com\.cn|cn)\/[A-Za-z0-9]+-\d+-[^"'\s<>]+(?:\?[^"'\s<>]+)?/);
          if (urlMatch) {
            finalUrl = urlMatch[0];
            console.log('从响应文本中成功提取URL:', finalUrl);
          } else {
            // 如果响应中找不到URL，尝试其他可能的模式
            const altMatch = text.match(/https:\/\/app\.teachermate\.(?:com\.cn|cn)\/[A-Za-z0-9]+-\d+(?:\?[^"'\s<>]+)?/);
            if (altMatch) {
              finalUrl = altMatch[0];
              console.log('从响应文本中提取到简短URL:', finalUrl);
            } else {
              throw new Error(`无法从响应中提取下载URL (状态码: ${response.status})`);
            }
          }
        }
      } else {
        console.error('服务器返回非预期状态码:', response.status);
        throw new Error(`服务器响应异常 (状态码: ${response.status})`);
      }
    } catch (error) {
      console.error('获取下载URL失败:', error);
      throw error;
    }
    
    // 3. 处理最终URL - 根据用户提供的新流程
    if (finalUrl) {
      try {
        // 首先检查是否包含OSSAccessKeyId参数
        if (finalUrl.includes('OSSAccessKeyId=')) {
          console.log('发现包含OSSAccessKeyId参数的URL:', finalUrl);
          
          // 获取OSSAccessKeyId参数的位置
          const ossIndex = finalUrl.indexOf('?OSSAccessKeyId');
          if (ossIndex > 0) {
            // 向前查找最后一个https://
            const startIndex = finalUrl.lastIndexOf('https://', ossIndex);
            
            if (startIndex >= 0) {
              // 提取https://到?OSSAccessKeyId之间的内容
              finalUrl = finalUrl.substring(startIndex, ossIndex);
              console.log('提取到的下载链接:', finalUrl);
              // 替换编码的空格
              finalUrl = finalUrl.replace(/%20/g, ' ');
            } else {
              // 如果找不到https://，则使用?前的内容
              finalUrl = finalUrl.split('?')[0];
              console.log('无法找到https://前缀，使用问号前的URL:', finalUrl);
            }
          } else {
            // 降级处理：使用问号前的内容
            finalUrl = finalUrl.split('?')[0];
            console.log('无法找到?OSSAccessKeyId，使用问号前的URL:', finalUrl);
          }
        }
        // 检查是否是teachermate域名
        else if (finalUrl.includes('teachermate.com.cn') || finalUrl.includes('teachermate.cn')) {
          console.log('处理teachermate URL');
          
          // 提取格式为"app.teachermate.com.cn/[一串字母]-[一串数字]-[ppt文件名]"的部分
          const pattern = /(https?:\/\/.*?teachermate\.(?:com\.cn|cn)\/[A-Za-z0-9]+-\d+-[^?&]+)/;
          const match = finalUrl.match(pattern);
          
          if (match) {
            finalUrl = match[1];
            console.log('提取后的URL:', finalUrl);
          } else {
            // 如果没有匹配到特定格式，尝试删除所有查询参数
            finalUrl = finalUrl.split('?')[0];
            console.log('移除查询参数后的URL:', finalUrl);
          }
          // 替换编码的空格
          finalUrl = finalUrl.replace(/%20/g, ' ');
        }
      } catch (error) {
        console.error('处理最终URL失败:', error);
        // 如果处理失败，继续使用重定向URL
      }
    }
    
    // 4. 提取文件名
    let filename = '';
    try {
      // 从URL路径中提取文件名
      const pathParts = finalUrl.split('/');
      let lastPart = pathParts[pathParts.length - 1].split('?')[0];
      
      // 尝试从最后一段提取文件名
      const filenameMatch = lastPart.match(/[A-Za-z0-9]+-\d+-(.+)/);
      if (filenameMatch && filenameMatch[1]) {
        // 标准格式URL: 提取第三部分作为文件名
        filename = filenameMatch[1];
        console.log('从标准URL格式提取文件名:', filename);
      } else {
        // 简化URL格式: 可能只有两部分 (例如 fN5Ke-1739834885236)
        const simpleMatch = lastPart.match(/[A-Za-z0-9]+-(\d+)/);
        if (simpleMatch && simpleMatch[1]) {
          // 尝试根据时间戳生成一个更有意义的文件名
          const timestamp = parseInt(simpleMatch[1]);
          if (!isNaN(timestamp)) {
            try {
              // 尝试将时间戳转换为日期，格式化为文件名
              const date = new Date(timestamp);
              if (date && date.getFullYear() > 2000) { // 有效日期
                filename = `课件_${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}`;
                console.log('从时间戳生成文件名:', filename);
              } else {
                filename = `课件_${simpleMatch[1]}`;
              }
            } catch (e) {
              filename = `课件_${simpleMatch[1]}`;
            }
          } else {
            filename = lastPart; // 使用整个最后部分
          }
        } else {
          // 如果没有匹配到任何模式，使用整个最后部分
          filename = lastPart;
        }
      }
      
      // 检查是否有扩展名，如果没有，添加.pptx
      if (!filename.includes('.')) {
        // 基于URL分析尝试确定最可能的文件类型
        let extension = '.pptx'; // 默认为pptx
        
        // 检查原始URL或最终URL中是否有文件类型提示
        const originalUrlLower = url.toLowerCase();
        const finalUrlLower = finalUrl.toLowerCase();
        
        if (originalUrlLower.includes('=pdf') || finalUrlLower.includes('pdf')) {
          extension = '.pdf';
        } else if (originalUrlLower.includes('=doc') || finalUrlLower.includes('doc')) {
          extension = '.docx';
        } else if (originalUrlLower.includes('=xls') || finalUrlLower.includes('excel')) {
          extension = '.xlsx';
        }
        
        filename += extension;
      }
      
      // 确保文件名不为空
      if (!filename || filename.length === 0) {
        throw new Error('无法提取文件名');
      }
      
      // 最终清理：替换文件名中的非法字符
      filename = filename.replace(/[\\/:*?"<>|]/g, '_');
    } catch (error) {
      console.warn('提取文件名失败，使用默认文件名:', error);
      filename = `课件_${Date.now()}.pptx`;
    }
    
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

console.log('Background service worker started.'); 