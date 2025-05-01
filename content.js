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
      }
    };
    console.log('PPTDownloader 实例已创建，开始初始化');
    this.init();
  }

  init() {
    // Removed UI injection call, as styles are now in styles.css
    this.startMonitoring();
    this.addGlobalListener();
    console.log('PPTDownloader 初始化完成');
  }

  // Removed injectUI method

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
    window.addEventListener('message', event => {
      // Basic security check: only accept messages from the same origin
      if (event.source !== window || !event.data || event.data.source !== 'ppt-downloader-popup') {
          return;
      }
      
      if (event.data.type === 'pptBatchDownload') {
        console.log('Received batch download request:', event.data.payload);
        this.handleBatchDownload(event.data.payload);
      }
    });
  }

  async handleBatchDownload(urls) {
    const delay = () => new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
    let successCount = 0;
    let failCount = 0;
    
    this.showToast(`开始批量下载 ${urls.length} 个文件...`, 'info');
    
    for (const url of urls) {
      try {
        await this.handleDownload(url);
        successCount++;
        await delay(); // Wait before starting the next download
      } catch (error) {
        failCount++;
        console.error(`批量下载项失败: ${url}`, error);
        this.showToast(`文件下载失败: ${this.extractFilename(url)}`, 'error');
        // Optionally add a longer delay after an error
        await delay(); 
      }
    }
    
    this.showToast(`批量下载完成: ${successCount} 成功, ${failCount} 失败`, failCount > 0 ? 'warning' : 'success');
  }
}

// 初始化下载器
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PPTDownloader());
} else {
    new PPTDownloader();
} 