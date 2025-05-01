// 添加自我检测代码
console.log('微助教PPT下载器 - content.js 已加载', window.location.href);

// 全局标识，方便检测脚本是否已加载
window.PPT_DOWNLOADER_LOADED = true;

class PPTDownloader {
  constructor() {
    this.observerConfig = {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    };
    
    // 增加目录页面检测标识
    this.isCatalogPage = false;
    
    // 更新目录页面的 URL 匹配规则，支持新域名
    this.CATALOG_URL_PATTERN = /coursewareinfo|preview/;
    
    // 增强 URL_VALIDATOR 以处理更多可能的链接格式
    this.URL_VALIDATOR = {
      // 检查是否为带ssl=1参数的原始链接
      isOriginalUrl: url => {
        // 原始的检查逻辑
        const basicCheck = /https:\/\/vip\.ow365\.cn\/\?.*ssl=1/.test(url);
        if (basicCheck) return true;
        
        // 扩展检查：只要是ow365的链接带有ssl参数就认为可能有效
        const extended = url.includes('vip.ow365.cn') && url.includes('ssl=');
        if (extended) {
          console.log('URL通过扩展检查:', url);
          return true;
        }
        
        return false;
      },
      isIntermediateUrl: url => {
        // 原始检查
        if (/https:\/\/vip\.ow365\.cn\/\?.*ssl=0/.test(url)) return true;
        
        // 扩展检查：如果URL包含ow365并且带有ssl=0
        return url.includes('vip.ow365.cn') && url.includes('ssl=0');
      },
      isFinalUrl: url => {
        // 原始检查
        if (/https:\/\/app\.teachermate\.com\.cn\/[A-Za-z0-9]+-\d+-[^/?]+/.test(url)) return true;
        
        // 扩展检查：支持teachermate.com.cn和teachermate.cn域名
        return url.includes('teachermate.com.cn/') || url.includes('teachermate.cn/');
      },
      // 检查当前是否在Office预览页面
      isOfficePreviewPage: url => {
        return (url.includes('view.officeapps.live.com') || 
                url.includes('office.com') || 
                url.includes('office365.com')) && 
               url.includes('src=');
      },
      // 从预览页面URL中提取原始资源URL
      extractResourceUrl: url => {
        try {
          const match = url.match(/src=([^&]+)/);
          if (match && match[1]) {
            return decodeURIComponent(match[1]);
          }
          return null;
        } catch (e) {
          console.error('提取资源URL失败:', e);
          return null;
        }
      }
    };

    // 初始化调试面板
    this.initDebugPanel();
    
    console.log('PPTDownloader 实例已创建，开始初始化');
    this.init();
    
    // 添加新的状态变量
    this.coursewareData = null;
    this.isDataLoaded = false;
    this.courseId = null;
    this.openId = null;
    
    // 添加新的属性用于爬取控制
    this.isScanning = false;
    this.scanQueue = [];
    this.scannedChapters = new Set();
    this.allCoursewareLinks = [];
  }

  init() {
    // 监听页面变化
    this.startMonitoring();
    this.addGlobalListener();
    this.checkIfCatalogPage();
    this.interceptXHRRequests();
    this.extractPageParams();
  }

  startMonitoring() {
    console.log('开始监控页面变化');
    new MutationObserver(mutations => this.handleMutations(mutations))
      .observe(document.body, this.observerConfig);
    this.scanExistingLinks();
  }

  handleMutations(mutations) {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) this.processNode(node);
        });
      }
    });
  }

  scanExistingLinks() {
    console.log('扫描页面现有链接');
    const allLinks = document.querySelectorAll('a[href*="vip.ow365.cn"]');
    console.log(`找到 ${allLinks.length} 个可能的链接`);
    
    let validLinkCount = 0;
    allLinks.forEach(link => {
      // Added check for original URL format using validator
      if (this.URL_VALIDATOR.isOriginalUrl(link.href)) {
          validLinkCount++;
          this.processLink(link);
      }
    });
    console.log(`其中 ${validLinkCount} 个链接符合下载条件`);
  }

  processNode(node) {
    if (node.matches('a[href*="vip.ow365.cn"]') && this.URL_VALIDATOR.isOriginalUrl(node.href)) {
      this.processLink(node);
    } else {
      node.querySelectorAll('a[href*="vip.ow365.cn"]').forEach(link => {
        if (this.URL_VALIDATOR.isOriginalUrl(link.href)) {
          this.processLink(link);
        }
      });
    }
  }

  processLink(link) {
    if (link.dataset.processed) return;
    link.dataset.processed = true;
    
    const downloadBtn = this.createDownloadButton(link.href);
    // Insert slightly differently to avoid issues if link is inside another element
    link.insertAdjacentElement('afterend', downloadBtn);
  }

  createDownloadButton(originalUrl) {
    const btn = document.createElement('button');
    btn.className = 'ppt-download-btn';
    btn.innerHTML = '↓ 智能下载';
    btn.onclick = (e) => {
      e.preventDefault(); // Prevent default link navigation
      e.stopPropagation(); // Prevent event bubbling
      this.handleDownload(originalUrl);
    };
    return btn;
  }

  async handleDownload(originalUrl) {
    try {
      this.showToast('开始处理链接...', 'info');
      if (!this.URL_VALIDATOR.isOriginalUrl(originalUrl)) {
        throw new Error('无效的原始URL格式');
      }
      const stage1Url = this.modifySSLParam(originalUrl);
      if (!this.URL_VALIDATOR.isIntermediateUrl(stage1Url)) {
        throw new Error('URL修改失败 (ssl=0)');
      }

      const finalUrl = await this.getFinalUrl(stage1Url);
       if (!this.URL_VALIDATOR.isFinalUrl(finalUrl)) {
        // Check for new params before declaring failure
        const newParams = this.detectNewSignatureParams(finalUrl);
        if (newParams.length > 0) {
            console.warn('检测到新的或意外的URL参数:', newParams);
            this.showToast(`检测到新参数: ${newParams.join(', ')}，可能需要更新插件`, 'warning');
            // Proceed anyway, maybe cleaning still works
        } else {
            // Only throw error if no new params detected and format is wrong
            throw new Error('获取最终URL格式不符合预期');
        }
      }
      
      chrome.runtime.sendMessage({
        type: 'downloadPPT',
        url: finalUrl,
        filename: this.extractFilename(finalUrl)
      });
      
      this.showToast('下载任务已发送至后台', 'success');
    } catch (error) {
      console.error('下载处理出错:', error);
      this.showToast(`处理失败: ${error.message}`, 'error');
    }
  }

  modifySSLParam(url) {
    // Ensure it only replaces if ssl=1 exists
    if (url.includes('ssl=1')) {
        return url.replace('ssl=1', 'ssl=0');
    }
    return url; // Return original if ssl=1 not found
  }

  async getFinalUrl(url) {
    try {
        const response = await fetch(url, { redirect: 'manual' });
        
        if (![301, 302, 307, 308].includes(response.status)) { // Include temporary redirects
          console.error('重定向响应状态码:', response.status);
          throw new Error(`未触发预期重定向 (状态码: ${response.status})`);
        }
        
        const redirectUrl = response.headers.get('location');
        if (!redirectUrl) {
            throw new Error('重定向响应缺少 Location 头');
        }
        console.log('Redirect URL:', redirectUrl);
        return this.cleanSignatureParams(redirectUrl);
    } catch (networkError) {
        console.error('获取重定向URL时网络错误:', networkError);
        throw new Error(`网络请求失败: ${networkError.message}`);
    }
  }

  cleanSignatureParams(url) {
    try {
      // 首先检查是否包含OSSAccessKeyId参数
      if (url.includes('OSSAccessKeyId=')) {
        console.log('发现包含OSSAccessKeyId参数的URL:', url);
        
        // 获取OSSAccessKeyId参数的位置
        const ossIndex = url.indexOf('?OSSAccessKeyId');
        if (ossIndex > 0) {
          // 向前查找最后一个https://
          const startIndex = url.lastIndexOf('https://', ossIndex);
          
          if (startIndex >= 0) {
            // 提取https://到?OSSAccessKeyId之间的内容
            const finalUrl = url.substring(startIndex, ossIndex);
            console.log('提取到的下载链接:', finalUrl);
            return finalUrl.replace(/%20/g, ' ');
          }
        }
      }
      
      // 如果无法通过新的策略提取URL，则使用原有逻辑
      const urlObj = new URL(url);
      const paramsToRemove = ['OSSAccessKeyId', 'Expires', 'Signature', 'exires', 'accesskeyid', 'signature']; // Added lowercase variants just in case
      let changed = false;
      paramsToRemove.forEach(param => {
        if (urlObj.searchParams.has(param)) {
            urlObj.searchParams.delete(param);
            changed = true;
        }
      });
      
      // Clean up potential empty query string
      let finalUrl = urlObj.toString();
      if (finalUrl.endsWith('?')) {
          finalUrl = finalUrl.slice(0, -1);
      }
      
      // Replace encoded spaces, ensure it's the last step
      finalUrl = finalUrl.replace(/%20/g, ' ');
      console.log('Cleaned URL:', finalUrl);
      return finalUrl;
    } catch (e) {
      console.warn('URL解析或清理失败，返回原始URL路径部分:', e);
      // Fallback: return URL without query string if parsing fails
      const urlParts = url.split('?');
      return urlParts[0].replace(/%20/g, ' ');
    }
  }

  // Added function from the plan
  detectNewSignatureParams(url) {
    try {
        const params = new URL(url).searchParams;
        const knownParams = new Set(['OSSAccessKeyId', 'Expires', 'Signature', 'ssl', 'fname', 'furl', 'fid', 'convert', 'previewtype']); // Add known non-signature params
        const suspiciousParams = [];
        
        params.forEach((_, key) => {
            // Consider suspicious if not known and contains uppercase or is long
            if (!knownParams.has(key.toLowerCase()) && (key.match(/[A-Z]/) || key.length > 10)) {
                suspiciousParams.push(key);
            }
        });
        
        return suspiciousParams;
    } catch {
        console.warn('解析URL以检测新参数时失败');
        return [];
    }
  }

  extractFilename(url) {
    try {
        // Try extracting from fname first
        const urlParams = new URLSearchParams(new URL(url).search);
        if (urlParams.has('fname')) {
            const fname = decodeURIComponent(urlParams.get('fname'));
            // Basic sanitization within extraction
            return fname.replace(/[\/:*?"<>|]/g, '_').substring(0, 200) || 'downloaded_file';
        }
        
        // Fallback based on path
        const decodedUrl = decodeURIComponent(url);
        const pathParts = decodedUrl.split('?')[0].split('/');
        let filename = pathParts.pop() || 'downloaded_file'; // Get last part or default
        
        // Attempt to extract a more meaningful name if it follows the pattern
        const nameMatch = filename.match(/^\d+-\d+-\d+-(.*)$/);
        if (nameMatch && nameMatch[1]) {
            filename = nameMatch[1].trim();
        } else {
            // If no pattern match, remove potential UUID-like prefixes
             filename = filename.replace(/^[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}-/, '').trim();
        }

        // Ensure filename is not empty after cleaning
        filename = filename || 'downloaded_file';
        
        // Sanitize potentially problematic characters
        return filename.replace(/[\/:*?"<>|]/g, '_').substring(0, 200);
    } catch (e) {
        console.error('提取文件名时出错:', e);
        return 'downloaded_file'; // Default filename on error
    }
}

  showToast(message, type = 'info') { // Default type to 'info'
    const toastId = `toast-${Date.now()}`;
    let toast = document.getElementById(toastId);
    if (toast) return; // Avoid duplicate toasts if called rapidly

    toast = document.createElement('div');
    toast.id = toastId;
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '12px 24px';
    let backgroundColor = '#2196F3'; // Info blue
    if (type === 'success') backgroundColor = '#4CAF50'; // Success green
    if (type === 'error') backgroundColor = '#f44336'; // Error red
    if (type === 'warning') backgroundColor = '#ff9800'; // Warning orange
    toast.style.background = backgroundColor;
    toast.style.color = 'white';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = 99999; // Ensure high z-index
    toast.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    toast.style.opacity = '0'; // Start transparent for fade-in
    toast.style.transition = 'opacity 0.5s ease-in-out';
    
    document.body.appendChild(toast);
    
    // Trigger fade-in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.opacity = '0'; // Fade out
        setTimeout(() => toast.remove(), 500); // Remove after fade out
    }, type === 'error' || type === 'warning' ? 5000 : 3000); // Longer display for errors/warnings
  }

  addGlobalListener() {
    window.addEventListener('message', async event => {
      if (event.source !== window || !event.data || event.data.source !== 'ppt-downloader-popup') {
        return;
      }
      
      if (event.data.type === 'pptBatchDownload') {
        console.log('收到批量下载请求:', event.data.payload);
        if (this.isCatalogPage) {
          // 如果是目录页面，启动自动扫描
          await this.scanAllChapters();
        } else {
          // 如果是普通页面，使用传统方式处理
          this.handleBatchDownload(event.data.payload);
        }
      }
    });
  }

  async handleBatchDownload(urls) {
    console.log(`开始处理 ${urls.length} 个下载链接`);
    
    for (const url of urls) {
      try {
        await this.handleDownload(url);
        // 添加延迟避免过快下载
        await this.delay(1500);
      } catch (error) {
        console.error('处理下载链接失败:', error);
      }
    }
  }

  // 检查是否为目录页面
  checkIfCatalogPage() {
    this.isCatalogPage = this.CATALOG_URL_PATTERN.test(window.location.href);
    if (this.isCatalogPage) {
      console.log('检测到目录页面，准备添加批量下载按钮');
      this.addCatalogPageButton();
    }
  }

  // 在目录页面添加批量下载按钮
  addCatalogPageButton() {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      background: white;
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    `;

    const button = document.createElement('button');
    button.textContent = '批量下载全部章节';
    button.style.cssText = `
      background: #2196F3;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    button.onclick = () => this.handleCatalogDownload();

    container.appendChild(button);
    document.body.appendChild(container);
  }

  // 处理目录页面的批量下载
  async handleCatalogDownload() {
    try {
      this.showToast('开始扫描章节...', 'info');
      
      // 获取所有章节链接
      const chapterLinks = await this.extractChapterLinks();
      
      if (chapterLinks.length === 0) {
        this.showToast('未找到可下载的章节', 'error');
        return;
      }

      this.showToast(`找到 ${chapterLinks.length} 个章节，开始下载...`, 'info');
      
      // 发送批量下载请求
      window.postMessage({
        source: 'ppt-downloader-popup',
        type: 'pptBatchDownload',
        payload: chapterLinks
      }, '*');
      
    } catch (error) {
      console.error('批量下载失败:', error);
      this.showToast('批量下载失败: ' + error.message, 'error');
    }
  }

  // 提取页面参数
  extractPageParams() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      this.courseId = urlParams.get('courseid');
      this.openId = urlParams.get('openid');
      console.log('提取到页面参数:', { courseId: this.courseId, openId: this.openId });
    } catch (e) {
      console.error('提取页面参数失败:', e);
    }
  }

  // 拦截 XHR 请求以获取课件数据
  interceptXHRRequests() {
    const originalXHROpen = window.XMLHttpRequest.prototype.open;
    const originalXHRSend = window.XMLHttpRequest.prototype.send;
    const self = this;

    window.XMLHttpRequest.prototype.open = function() {
      this._url = arguments[1];
      this._method = arguments[0];
      return originalXHROpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function() {
      if (this._url.includes('/preview') || this._url.includes('/coursewareinfo')) {
        this.addEventListener('load', function() {
          try {
            const response = JSON.parse(this.responseText);
            if (response && (response.data || response.coursewares)) {
              self.processPageData(response);
            }
          } catch (e) {
            console.error('处理API响应失败:', e);
          }
        });
      }
      return originalXHRSend.apply(this, arguments);
    };
  }

  // 处理页面数据
  processPageData(response) {
    try {
      if (response.coursewares) {
        this.coursewareData = response.coursewares;
      } else if (response.data) {
        if (!this.coursewareData) {
          this.coursewareData = [];
        }
        if (Array.isArray(response.data)) {
          this.coursewareData.push(...response.data);
        } else {
          this.coursewareData.push(response.data);
        }
      }
      this.isDataLoaded = true;
      console.log('处理到的课件数据:', this.coursewareData);
    } catch (e) {
      console.error('处理课件数据失败:', e);
    }
  }

  // 修改 fetchCoursewareData 方法
  async fetchCoursewareData() {
    try {
      this.debug.log('开始获取课件数据');
      
      // 从URL中获取参数
      const urlParams = new URLSearchParams(window.location.search);
      const courseId = urlParams.get('courseid');
      const openId = urlParams.get('openid');
      
      this.debug.log('URL参数:', { courseId, openId });
      
      if (!courseId || !openId) {
        // 尝试从页面中查找参数
        const pageData = this.extractPageData();
        if (!pageData.courseId || !pageData.openId) {
          throw new Error('无法获取必要的参数：courseId 或 openId');
        }
        this.debug.log('从页面中提取到参数:', pageData);
        return this.requestCourseware(pageData.courseId, pageData.openId);
      }
      
      return this.requestCourseware(courseId, openId);
    } catch (error) {
      this.debug.error('获取课件数据失败:', error);
      throw error; // 向上传递错误，而不是返回null
    }
  }

  // 从页面中提取参数
  extractPageData() {
    this.debug.log('尝试从页面中提取参数');
    const result = {
      courseId: null,
      openId: null
    };

    try {
      // 1. 尝试从全局变量中获取
      if (window.__INITIAL_STATE__) {
        const state = window.__INITIAL_STATE__;
        this.debug.log('找到页面状态数据:', state);
        if (state.coursewareInfo) {
          result.courseId = state.coursewareInfo.courseid || state.coursewareInfo.courseId;
          result.openId = state.coursewareInfo.openid || state.coursewareInfo.openId;
        }
      }

      // 2. 尝试从DOM中查找
      if (!result.courseId || !result.openId) {
        // 查找可能包含参数的元素
        document.querySelectorAll('script').forEach(script => {
          const content = script.textContent;
          if (content.includes('courseid') || content.includes('openid')) {
            const courseIdMatch = content.match(/courseid['":\s]+([^'"}\s]+)/i);
            const openIdMatch = content.match(/openid['":\s]+([^'"}\s]+)/i);
            if (courseIdMatch) result.courseId = courseIdMatch[1];
            if (openIdMatch) result.openId = openIdMatch[1];
          }
        });
      }

      // 3. 尝试从当前URL中的其他参数获取
      if (!result.courseId || !result.openId) {
        const allParams = new URLSearchParams(window.location.search);
        allParams.forEach((value, key) => {
          if (key.toLowerCase().includes('courseid')) result.courseId = value;
          if (key.toLowerCase().includes('openid')) result.openId = value;
        });
      }

      this.debug.log('提取到的参数:', result);
      return result;
    } catch (error) {
      this.debug.error('提取页面参数失败:', error);
      return result;
    }
  }

  // 修改 requestCourseware 方法
  async requestCourseware(courseId, openId) {
    try {
      this.debug.log('请求课件数据:', { courseId, openId });
      
      const response = await fetch(`https://v18.teachermate.cn/wechat-pro-ssr/student/coursewareinfo?courseid=${courseId}&openid=${openId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      this.debug.log('获取到课件数据:', data);
      
      // 验证响应数据格式
      if (!data) {
        throw new Error('服务器返回空数据');
      }
      
      if (data.coursewares && Array.isArray(data.coursewares)) {
        return data.coursewares;
      } else if (data.data && Array.isArray(data.data)) {
        return data.data;
      } else if (data.error) {
        throw new Error(`服务器返回错误: ${data.error}`);
      }
      
      throw new Error('返回数据格式不正确：未找到课件数组');
    } catch (error) {
      this.debug.error('请求课件数据失败:', error);
      throw error; // 向上传递错误
    }
  }

  // 修改 extractChapterLinks 方法
  async extractChapterLinks() {
    return new Promise(async (resolve, reject) => {
      let retryCount = 0;
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 2000; // 2秒
      
      const checkData = async () => {
        try {
          // 获取课件数据
          const coursewares = await this.fetchCoursewareData();
          
          if (coursewares && coursewares.length > 0) {
            this.debug.log(`找到 ${coursewares.length} 个课件`);
            const links = this.processCoursewares(coursewares);
            
            if (links.length > 0) {
              this.debug.log(`提取到 ${links.length} 个下载链接`);
              return resolve(links);
            }
          }
          
          // 如果API没有返回数据，尝试从DOM中提取
          const domLinks = this.extractLinksFromDOM();
          if (domLinks.length > 0) {
            this.debug.log(`从DOM中提取到 ${domLinks.length} 个链接`);
            return resolve(domLinks);
          }
          
          // 如果还是没有找到链接，并且未达到最大重试次数，则重试
          if (retryCount < MAX_RETRIES) {
            this.debug.log(`未找到链接，第 ${retryCount + 1} 次重试...`);
            retryCount++;
            setTimeout(checkData, RETRY_DELAY);
          } else {
            this.debug.log('达到最大重试次数，停止尝试');
            reject(new Error('未能找到任何课件链接'));
          }
        } catch (error) {
          this.debug.error('提取链接时出错:', error);
          
          // 如果是参数错误，直接结束
          if (error.message.includes('无法获取必要的参数')) {
            reject(error);
            return;
          }
          
          // 其他错误进行重试
          if (retryCount < MAX_RETRIES) {
            this.debug.log(`发生错误，第 ${retryCount + 1} 次重试...`);
            retryCount++;
            setTimeout(checkData, RETRY_DELAY);
          } else {
            reject(error);
          }
        }
      };
      
      checkData();
      
      // 20秒后超时
      setTimeout(() => {
        if (retryCount < MAX_RETRIES) {
          reject(new Error('获取课件链接超时'));
        }
      }, 20000);
    });
  }

  // 优化 processCoursewares 方法
  processCoursewares(coursewares) {
    const links = [];
    const processedUrls = new Set(); // 用于去重
    
    coursewares.forEach(courseware => {
      try {
        // 提取所有可能的URL
        const urls = [
          courseware.url,
          courseware.preview_url,
          courseware.coursewareUrl,
          courseware.downloadUrl,
          courseware.previewUrl
        ].filter(url => url && typeof url === 'string');
        
        urls.forEach(url => {
          // 标准化URL
          let normalizedUrl = url;
          if (!normalizedUrl.startsWith('http')) {
            normalizedUrl = normalizedUrl.startsWith('/') 
              ? `https://v18.teachermate.cn${normalizedUrl}`
              : `https://v18.teachermate.cn/${normalizedUrl}`;
          }
          
          // 检查是否是有效的课件URL
          if (this.URL_VALIDATOR.isOriginalUrl(normalizedUrl) && !processedUrls.has(normalizedUrl)) {
            this.debug.log('找到有效课件链接:', normalizedUrl);
            processedUrls.add(normalizedUrl);
            links.push(normalizedUrl);
          }
        });
      } catch (e) {
        this.debug.error('处理课件数据失败:', e, courseware);
      }
    });
    
    return links;
  }

  // 从 DOM 中提取链接
  extractLinksFromDOM() {
    const links = [];
    try {
      // 尝试多种可能的选择器
      const elements = document.querySelectorAll([
        'a[href*="preview"]',
        'a[href*="courseware"]',
        '[data-url]',
        '.courseware-item',
        '.chapter-item'
      ].join(','));

      elements.forEach(element => {
        let url = null;
        if (element.href) {
          url = element.href;
        } else if (element.dataset.url) {
          url = element.dataset.url;
        } else {
          const link = element.querySelector('a[href*="preview"], a[href*="courseware"]');
          if (link) {
            url = link.href;
          }
        }

        if (url) {
          // 转换为正确的URL格式
          if (url.includes('coursewareinfo')) {
            const urlParams = new URLSearchParams(new URL(url).search);
            const courseId = urlParams.get('courseid');
            const openId = urlParams.get('openid');
            if (courseId && openId) {
              url = `https://v18.teachermate.cn/wechat-pro-ssr/courseware/preview?courseid=${courseId}&openid=${openId}`;
            }
          }
          if (!links.includes(url)) {
            links.push(url);
          }
        }
      });
    } catch (e) {
      console.error('从DOM提取链接失败:', e);
    }
    return links;
  }

  // 初始化调试面板
  initDebugPanel() {
    // 创建调试面板容器
    const debugPanel = document.createElement('div');
    debugPanel.id = 'ppt-downloader-debug-panel';
    debugPanel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 300px;
      max-height: 400px;
      background: #2c3e50;
      color: #ecf0f1;
      padding: 10px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      z-index: 999999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      overflow-y: auto;
    `;

    // 添加标题
    const title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 10px;
      padding-bottom: 5px;
      border-bottom: 1px solid #34495e;
      color: #3498db;
    `;
    title.textContent = '微助教下载器调试面板';
    debugPanel.appendChild(title);

    // 添加日志容器
    const logContainer = document.createElement('div');
    logContainer.id = 'ppt-downloader-logs';
    debugPanel.appendChild(logContainer);

    // 添加控制按钮
    const controls = document.createElement('div');
    controls.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
    `;

    // 添加清除按钮
    const clearButton = document.createElement('button');
    clearButton.textContent = '清除';
    clearButton.style.cssText = `
      background: #e74c3c;
      color: white;
      border: none;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    `;
    clearButton.onclick = () => {
      logContainer.innerHTML = '';
    };
    controls.appendChild(clearButton);
    debugPanel.appendChild(controls);

    // 将调试面板添加到页面
    document.body.appendChild(debugPanel);

    // 添加调试方法
    this.debug = {
      log: (message, data = null) => {
        const logEntry = document.createElement('div');
        logEntry.style.cssText = `
          margin: 5px 0;
          padding: 5px;
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        `;
        
        const time = new Date().toLocaleTimeString();
        const messageText = data ? `${message} ${JSON.stringify(data)}`