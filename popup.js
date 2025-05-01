class BatchDownloadUI {
  constructor() {
    this.linkListElement = document.getElementById('linkList');
    this.scanButton = document.getElementById('scanLinks');
    this.downloadButton = document.getElementById('startDownload');
    this.statusText = document.getElementById('statusText');
    this.selectedCountSpan = document.getElementById('selectedCount');
    this.selectAllContainer = document.getElementById('selectAllContainer');
    this.selectAllCheckbox = document.getElementById('selectAllCheckbox');
    this.foundLinks = []; // Store the found links
    this.initialize();
  }

  initialize() {
    this.bindEvents();
    // Restore settings or previous state could be added here if needed
    // Example: this.restoreSettings(); 
    this.updateStatus('等待扫描...');
  }

  bindEvents() {
    this.scanButton.addEventListener('click', () => this.scanLinks());
    this.downloadButton.addEventListener('click', () => this.startBatch());
    this.linkListElement.addEventListener('change', (event) => {
        if (event.target.type === 'checkbox') {
            this.updateSelectedCount();
        }
    });
    this.selectAllCheckbox.addEventListener('change', (event) => {
        this.toggleSelectAll(event.target.checked);
    });
  }

  updateStatus(message, isError = false) {
      this.statusText.textContent = message;
      this.statusText.style.color = isError ? '#d9534f' : '#5cb85c'; // Red for error, Green for success/info
  }

  async scanLinks() {
    this.updateStatus('正在扫描页面...');
    this.scanButton.disabled = true;
    this.linkListElement.innerHTML = ''; // Clear previous results
    this.selectAllContainer.style.display = 'none';
    this.downloadButton.disabled = true;
    this.selectedCountSpan.textContent = '0';
    this.foundLinks = [];

    try {
        console.log('开始扫描课件链接...');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('当前标签页信息:', tab ? tab.url : '无法获取标签信息');

        if (!tab) {
            throw new Error('无法获取当前活动标签页。');
        }
        
        // 使用更宽松的URL匹配逻辑
        const url = tab.url || '';
        console.log('检查URL:', url);
        
        // 检查是否是微助教或TeacherMate的域名 - 使用简单的字符串包含检查
        const isWezhujiao = url.includes('wezhujiao.com');
        const isTeachermate = url.includes('teachermate.com.cn') || url.includes('teachermate.cn');
        console.log('域名匹配结果 - 微助教:', isWezhujiao, 'TeacherMate:', isTeachermate);
        
        if (!url || !(isWezhujiao || isTeachermate)) {
             console.error('域名检查失败：', url);
             throw new Error('当前页面不是微助教或 TeacherMate 课件页面，无法扫描。URL: ' + url);
        }
        
        console.log('域名检查通过，继续执行...');
        
        // 首先检查页面上是否有章节列表
        console.log('检查是否存在章节列表...');
        const hasChapterList = await this.checkForChapterList(tab.id);
        
        if (hasChapterList) {
            console.log('检测到章节列表，尝试获取所有章节的课件...');
            await this.scanChapterList(tab.id);
        } else {
            // 如果不是章节列表页面，使用原来的链接搜索方法
            console.log('未检测到章节列表，尝试常规搜索...');
            await this.scanRegularLinks(tab.id);
        }

    } catch (error) {
        console.error('扫描链接时出错:', error);
        this.updateStatus(`扫描失败: ${error.message}`, true);
        this.selectAllContainer.style.display = 'none';
    } finally {
        this.scanButton.disabled = false;
    }
  }

  // 检查页面是否有章节列表
  async checkForChapterList(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // 检查页面中是否存在章节列表的特征
        // 1. 检查URL是否包含coursewareinfo但不包含章节ID
        const isChapterListUrl = window.location.href.includes('coursewareinfo') && 
                               !window.location.href.includes('chapterid=');
        
        // 2. 检查页面中是否有章节列表元素
        const hasChapterElements = document.querySelectorAll('.chapter-item, [class*="chapter"], [class*="Chapter"]').length > 0;
        
        // 3. 检查页面状态中是否有章节数据
        let hasChapterData = false;
        try {
          if (window.__INITIAL_STATE__ && 
              window.__INITIAL_STATE__.coursewareInfo && 
              window.__INITIAL_STATE__.coursewareInfo.chapters && 
              window.__INITIAL_STATE__.coursewareInfo.chapters.length > 0) {
            hasChapterData = true;
          }
        } catch (e) {
          console.error('检查状态数据出错:', e);
        }
        
        console.log('章节列表检测结果:', { isChapterListUrl, hasChapterElements, hasChapterData });
        return isChapterListUrl || hasChapterElements || hasChapterData;
      }
    });
    
    return results && results[0] && results[0].result;
  }
  
  // 扫描章节列表页面，尝试提取所有章节的课件链接
  async scanChapterList(tabId) {
    console.log('执行章节列表扫描...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const coursewareLinks = [];
        console.log('开始从章节列表提取课件链接...');
        
        // 方法1: 从页面状态中提取
        try {
          console.log('尝试从页面状态获取课件数据...');
          if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.coursewareInfo) {
            const state = window.__INITIAL_STATE__.coursewareInfo;
            console.log('找到课件状态数据:', state);
            
            // 从状态中提取课件信息
            if (state.coursewares && state.coursewares.length > 0) {
              console.log(`找到 ${state.coursewares.length} 个课件`);
              state.coursewares.forEach(courseware => {
                console.log('课件信息:', courseware);
                
                // 检查是否有预览或下载URL
                if (courseware.preview_url && courseware.preview_url.includes('vip.ow365.cn')) {
                  coursewareLinks.push({
                    url: courseware.preview_url,
                    name: courseware.title || '未命名课件',
                    chapter: courseware.chapter_name || '未分类'
                  });
                } else if (courseware.url && courseware.url.includes('vip.ow365.cn')) {
                  coursewareLinks.push({
                    url: courseware.url,
                    name: courseware.title || '未命名课件',
                    chapter: courseware.chapter_name || '未分类'
                  });
                }
              });
            } else {
              console.log('状态中未找到课件数组');
            }
            
            // 尝试从章节数据中获取课件信息
            if (state.chapters && state.chapters.length > 0) {
              console.log(`找到 ${state.chapters.length} 个章节`);
              state.chapters.forEach(chapter => {
                if (chapter.coursewares && chapter.coursewares.length > 0) {
                  console.log(`章节 "${chapter.name}" 包含 ${chapter.coursewares.length} 个课件`);
                  chapter.coursewares.forEach(courseware => {
                    if (courseware.preview_url && courseware.preview_url.includes('vip.ow365.cn')) {
                      coursewareLinks.push({
                        url: courseware.preview_url,
                        name: courseware.title || '未命名课件',
                        chapter: chapter.name || '未分类'
                      });
                    } else if (courseware.url && courseware.url.includes('vip.ow365.cn')) {
                      coursewareLinks.push({
                        url: courseware.url,
                        name: courseware.title || '未命名课件',
                        chapter: chapter.name || '未分类'
                      });
                    }
                  });
                }
              });
            }
          }
        } catch (e) {
          console.error('从状态数据提取课件失败:', e);
        }
        
        // 方法2: 从页面DOM中寻找可能的课件链接
        try {
          console.log('尝试从DOM中查找可能的链接...');
          
          // 搜索页面中可能包含课件URL的数据属性
          const elementsWithData = document.querySelectorAll('[data-preview-url], [data-download-url], [data-url], [data-href]');
          console.log(`找到 ${elementsWithData.length} 个可能包含URL的元素`);
          
          elementsWithData.forEach(el => {
            let url = el.getAttribute('data-preview-url') || 
                      el.getAttribute('data-download-url') || 
                      el.getAttribute('data-url') || 
                      el.getAttribute('data-href');
                      
            if (url && url.includes('vip.ow365.cn')) {
              // 尝试获取课件名称
              let name = el.getAttribute('data-title') || 
                         el.getAttribute('title') || 
                         el.textContent.trim() || 
                         '未命名课件';
                         
              // 限制名称长度
              name = name.length > 50 ? name.substring(0, 47) + '...' : name;
              
              // 尝试获取章节名称
              let chapter = '未分类';
              // 向上查找可能的章节标题
              let parent = el.parentElement;
              while (parent && !chapter) {
                if (parent.classList && 
                    (parent.classList.contains('chapter') || 
                     parent.className.includes('Chapter') || 
                     parent.className.includes('chapter'))) {
                  const chapterTitle = parent.querySelector('h3, h4, .title, .chapter-title');
                  if (chapterTitle) {
                    chapter = chapterTitle.textContent.trim();
                  }
                }
                parent = parent.parentElement;
              }
              
              coursewareLinks.push({ url, name, chapter });
            }
          });
        } catch (e) {
          console.error('从DOM提取课件失败:', e);
        }
        
        // 方法3: 从页面源代码中查找所有可能的课件链接
        try {
          console.log('尝试从页面源代码中提取链接...');
          const pageSource = document.documentElement.outerHTML;
          const urlRegex = /https?:\/\/vip\.ow365\.cn[^"'\s)]+/g;
          const matches = pageSource.match(urlRegex) || [];
          
          console.log(`从源代码中找到 ${matches.length} 个可能的链接`);
          
          // 过滤出包含ssl=1的链接，这些通常是课件链接
          const filteredMatches = matches.filter(url => url.includes('ssl=1'));
          console.log(`其中 ${filteredMatches.length} 个链接包含ssl=1参数`);
          
          // 将找到的链接添加到结果中
          filteredMatches.forEach(url => {
            // 尝试从URL中提取文件名
            let name = '未命名课件';
            try {
              // 尝试从fname参数中提取
              const fnameMatch = url.match(/fname=([^&]+)/);
              if (fnameMatch && fnameMatch[1]) {
                name = decodeURIComponent(fnameMatch[1]);
              }
            } catch (e) {}
            
            // 如果链接不在现有结果中，添加它
            if (!coursewareLinks.some(link => link.url === url)) {
              coursewareLinks.push({ url, name, chapter: '从源码提取' });
            }
          });
        } catch (e) {
          console.error('从源代码提取课件失败:', e);
        }
        
        console.log(`总共从章节列表页面提取到 ${coursewareLinks.length} 个课件链接`);
        return coursewareLinks;
      }
    });
    
    const coursewareLinks = results && results[0] && results[0].result ? results[0].result : [];
    console.log('从章节列表提取的课件链接:', coursewareLinks);
    
    if (coursewareLinks.length > 0) {
      // 提取URL列表并显示
      const urls = coursewareLinks.map(item => item.url);
      this.foundLinks = urls;
      this.displayChapterLinks(coursewareLinks);
      this.updateStatus(`扫描完成，发现 ${urls.length} 个课件链接。`, false);
      this.selectAllContainer.style.display = 'block';
      this.selectAllCheckbox.checked = true;
      this.toggleSelectAll(true);
    } else {
      this.updateStatus('未找到任何课件链接。你可能需要登录或进入具体章节页面。', true);
    }
  }
  
  // 原来的链接扫描方法，重命名为scanRegularLinks
  async scanRegularLinks(tabId) {
    console.log('准备执行页面脚本...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        console.log('内容脚本注入成功，开始查找链接');
        // 记录当前页面的URL和DOM结构信息
        console.log('页面URL:', document.location.href);
        console.log('页面title:', document.title);
        
        // 收集所有可能的链接
        const allLinks = [];
        
        // 1. 查找直接的vip.ow365.cn链接
        const directLinks = Array.from(document.querySelectorAll('a[href*="vip.ow365.cn"]'));
        console.log('直接链接数量:', directLinks.length);
        directLinks.forEach(link => {
            console.log('  链接:', link.href, '文本:', link.textContent.trim());
            allLinks.push(link.href);
        });
        
        // 2. 检查页面源代码中的链接
        try {
            const pageSource = document.documentElement.outerHTML;
            const regex = /https?:\/\/vip\.ow365\.cn[^"'\s)]*/g;
            const matches = pageSource.match(regex) || [];
            console.log('源代码中找到链接:', matches.length);
            matches.forEach(url => {
                console.log('  源码链接:', url);
                if (!allLinks.includes(url)) allLinks.push(url);
            });
        } catch (e) {
            console.error('搜索源代码出错:', e);
        }
        
        // 去重
        const uniqueLinks = [...new Set(allLinks)];
        console.log('总共找到不重复链接:', uniqueLinks.length);
        
        // 尝试使用PPTDownloader的验证器，如果可用
        if (typeof PPTDownloader !== 'undefined' && PPTDownloader.prototype && PPTDownloader.prototype.URL_VALIDATOR) {
            console.log('使用PPTDownloader验证器');
            return uniqueLinks.filter(url => {
                try {
                    const isValid = PPTDownloader.prototype.URL_VALIDATOR.isOriginalUrl(url);
                    console.log('  验证结果:', url, isValid);
                    return isValid;
                } catch (e) {
                    console.error('  验证出错:', e);
                    return false; 
                }
            });
        } else {
            // 如果无法使用PPTDownloader，手动筛选
            console.log('无法使用PPTDownloader验证器，手动筛选');
            return uniqueLinks.filter(url => {
                // 检查是否包含ssl=1参数
                const hasSSL = url.includes('ssl=1');
                console.log('  手动筛选结果:', url, hasSSL);
                return hasSSL;
            });
        }
      }
    });
    
    console.log('脚本执行结果:', results);
    // executeScript returns an array of results, one per frame. We usually want the main frame's result.
    const urls = results && results[0] && results[0].result ? results[0].result : [];
    console.log('提取的URL列表:', urls);
    this.foundLinks = urls;

    if (urls.length > 0) {
        this.displayLinks(urls);
        this.updateStatus(`扫描完成，发现 ${urls.length} 个课件链接。`, false);
        this.selectAllContainer.style.display = 'block';
        this.selectAllCheckbox.checked = true; // Default to selected
        this.toggleSelectAll(true); // Update based on checkbox state
    } else {
        console.log('未找到符合条件的课件链接');
        this.updateStatus('未在当前页面找到符合条件的课件链接。', true);
        this.selectAllContainer.style.display = 'none';
    }
  }
  
  // 显示章节链接的新方法
  displayChapterLinks(coursewareLinks) {
    // 按章节分组
    const chapterGroups = {};
    coursewareLinks.forEach(item => {
      if (!chapterGroups[item.chapter]) {
        chapterGroups[item.chapter] = [];
      }
      chapterGroups[item.chapter].push(item);
    });
    
    // 清空列表
    this.linkListElement.innerHTML = '';
    
    // 按章节创建分组UI
    let index = 0;
    Object.keys(chapterGroups).sort().forEach(chapter => {
      // 添加章节标题
      const chapterHeader = document.createElement('div');
      chapterHeader.className = 'chapter-header';
      chapterHeader.style.fontWeight = 'bold';
      chapterHeader.style.margin = '10px 0 5px 0';
      chapterHeader.style.borderBottom = '1px solid #eee';
      chapterHeader.style.paddingBottom = '3px';
      chapterHeader.style.color = '#4a90e2';
      chapterHeader.textContent = chapter;
      this.linkListElement.appendChild(chapterHeader);
      
      // 添加章节下的课件
      chapterGroups[chapter].forEach(item => {
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';
        linkItem.innerHTML = `
          <input type="checkbox" id="link-${index}" data-url="${encodeURI(item.url)}" checked>
          <label for="link-${index}">${item.name}</label>
        `;
        this.linkListElement.appendChild(linkItem);
        index++;
      });
    });
    
    this.updateSelectedCount(); // 更新选中计数
  }

  displayLinks(urls) {
    this.linkListElement.innerHTML = urls.map((url, index) => `
      <div class="link-item">
        <input type="checkbox" id="link-${index}" data-url="${encodeURI(url)}" checked>
        <label for="link-${index}">${this.extractDisplayName(url)}</label>
      </div>
    `).join('');
    this.updateSelectedCount(); // Update count after displaying
  }

  extractDisplayName(url) {
    try {
        const urlParams = new URLSearchParams(new URL(url).search);
        if (urlParams.has('fname')) {
            return decodeURIComponent(urlParams.get('fname')) || '未知课件';
        }
        // Fallback if fname is not present
        const pathParts = decodeURIComponent(url).split('?')[0].split('/');
        const lastPart = pathParts.pop();
        // Basic check if it looks like a filename (contains a dot)
        if (lastPart && lastPart.includes('.')) {
            return lastPart;
        }
        return '未知课件'; // Default if no suitable name found
    } catch {
        return '无法解析的URL';
    }
  }

  updateSelectedCount() {
      const selectedCheckboxes = this.linkListElement.querySelectorAll('input[type="checkbox"]:checked');
      const count = selectedCheckboxes.length;
      this.selectedCountSpan.textContent = count;
      this.downloadButton.disabled = count === 0;
      
      // Update select all checkbox state
      const totalCheckboxes = this.linkListElement.querySelectorAll('input[type="checkbox"]').length;
      if (totalCheckboxes > 0) {
        this.selectAllCheckbox.checked = count === totalCheckboxes;
        this.selectAllCheckbox.indeterminate = count > 0 && count < totalCheckboxes;
      } else {
        this.selectAllCheckbox.checked = false;
        this.selectAllCheckbox.indeterminate = false;
      }
  }

  toggleSelectAll(isChecked) {
      const checkboxes = this.linkListElement.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(checkbox => checkbox.checked = isChecked);
      this.updateSelectedCount();
  }

  async startBatch() {
    const selectedCheckboxes = this.linkListElement.querySelectorAll('input[type="checkbox"]:checked');
    const urlsToDownload = Array.from(selectedCheckboxes).map(checkbox => decodeURI(checkbox.dataset.url));

    if (urlsToDownload.length === 0) {
      this.updateStatus('请至少选择一个文件进行下载。', true);
      return;
    }

    this.updateStatus(`正在准备 ${urlsToDownload.length} 个文件下载...`);
    this.downloadButton.disabled = true; // Disable button during processing
    this.scanButton.disabled = true; // Also disable scan during download

    try {
        // 解码HTML实体编码
        const sanitizedUrls = urlsToDownload.map(url => {
          // 将&amp;转换为&
          return url.replace(/&amp;/g, '&');
        });
        console.log('解码后的URL:', sanitizedUrls);
        
        // 提示用户下载已开始处理
        this.updateStatus(`正在处理下载请求，这可能需要一点时间...`);
        
        // 发送消息给background.js
        chrome.runtime.sendMessage({
            type: 'batchDownload',
            urls: sanitizedUrls
        }, (response) => {
            console.log('批量下载请求响应:', response);
            
            if (response && response.success) {
                this.updateStatus(`已开始下载 ${sanitizedUrls.length} 个文件，请在下载管理器中查看进度。`, false);
                
                // 显示下载信息
                const downloadInfo = document.createElement('div');
                downloadInfo.style.marginTop = '10px';
                downloadInfo.style.fontSize = '0.9em';
                downloadInfo.style.color = '#4a90e2';
                downloadInfo.innerHTML = `
                  <p>文件将在后台依次下载。请注意：</p>
                  <ul style="margin-top: 5px; padding-left: 20px;">
                    <li>每个文件间隔1.5秒开始处理</li>
                    <li>可以在浏览器的下载管理器中查看下载进度</li>
                    <li>弹窗关闭不会影响下载过程</li>
                  </ul>
                `;
                
                // 查找合适的位置插入下载信息
                const container = document.querySelector('.container');
                if (container && this.statusText.parentNode) {
                    this.statusText.parentNode.appendChild(downloadInfo);
                }
                
                // 将下载按钮改为可关闭弹窗
                this.downloadButton.textContent = '关闭窗口';
                this.downloadButton.disabled = false;
                this.downloadButton.onclick = () => window.close();
                
                // 扫描按钮仍保持禁用状态
                this.scanButton.disabled = true;
            } else {
                const errorMessage = response?.error || '未知错误';
                this.updateStatus(`批量下载请求失败: ${errorMessage}`, true);
                this.downloadButton.disabled = false;
                this.scanButton.disabled = false;
            }
        });
    } catch (error) {
        console.error('发送批量下载请求时出错:', error);
        this.updateStatus(`启动批量下载失败: ${error.message}`, true);
        // Re-enable buttons on failure to allow retry
        this.downloadButton.disabled = urlsToDownload.length === 0; 
        this.scanButton.disabled = false;
    }
  }
  
  // Optional: Method to restore settings (e.g., last selected items)
  // restoreSettings() { 
  //   chrome.storage.local.get(['lastScanResults'], (result) => {
  //     if (result.lastScanResults) {
  //       this.foundLinks = result.lastScanResults;
  //       this.displayLinks(this.foundLinks);
  //       this.updateStatus(`恢复了上次扫描的 ${this.foundLinks.length} 个链接。`);
  //     }
  //   });
  // }
}

// Initialize the UI logic when the popup DOM is ready
document.addEventListener('DOMContentLoaded', () => new BatchDownloadUI()); 