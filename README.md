 # 微助教课件下载插件

这是一个 Edge 浏览器插件，用于下载微助教平台上的课件资源。该插件支持批量下载功能，可以帮助教师更方便地管理和下载课件资源。

## 功能特点

- 支持微助教平台课件页面的自动识别
- 支持 PPT、PDF、Word 等多种文件格式的下载
- 智能文件名处理，保留原始文件名
- 支持批量下载功能
- 自动处理下载队列，避免并发下载导致的问题
- 内置重试机制，提高下载成功率

## 安装说明

1. 克隆或下载本项目代码
2. 打开 Edge 浏览器，进入扩展管理页面（edge://extensions/）
3. 开启"开发人员模式"
4. 点击"加载解压缩的扩展"
5. 选择本项目的根目录

## 使用方法

1. 安装插件后，在 Edge 浏览器右上角会出现插件图标
2. 访问微助教课件页面（支持 app.teachermate.com.cn 域名）
3. 点击插件图标，会显示当前页面可下载的课件
4. 选择需要下载的课件，点击下载按钮即可

## 注意事项

- 插件仅支持微助教平台（app.teachermate.com.cn）的课件下载
- 下载过程中请保持浏览器窗口打开
- 如遇下载失败，插件会自动重试（最多3次）
- 文件会自动下载到浏览器默认下载目录
- 如果文件名不包含扩展名，插件会根据文件类型自动添加合适的扩展名

## 技术实现

插件主要包含以下组件：
- `manifest.json`: 插件配置文件
- `popup.html` & `popup.js`: 插件弹出窗口界面
- `content.js`: 页面内容处理脚本
- `background.js`: 后台服务处理脚本
- `styles.css`: 样式文件

## 调试说明

1. 在浏览器开发者工具中查看 Console 输出
2. 插件的后台脚本会输出详细的日志信息
3. 如遇问题，可以通过日志定位具体原因

## 常见问题

1. 提示"当前页面不是微助教课件页面"
   - 检查当前页面是否为 app.teachermate.com.cn 域名
   - 确认页面是否包含课件内容

2. 下载失败
   - 检查网络连接
   - 查看浏览器控制台是否有错误信息
   - 尝试刷新页面后重新下载

## 许可证

本项目采用 MIT 许可证。

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。