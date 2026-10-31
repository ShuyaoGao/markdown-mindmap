# 第三方依赖、素材与来源说明

## 浏览器页面（play/）

| 项目 | 说明 | 许可证 |
|---|---|---|
| 第三方 JavaScript 库 | **无**。`play/` 里的 HTML / CSS / JS 全部为本项目自写，不引用 CDN，不联网。树模型、Markdown 解析、三种布局、SVG 绘制、拖拽、双指缩放、XML 解析（OPML / FreeMind）全部自己实现，没有复制 markmap、mind-elixir、jsMind 等库的代码。 | — |
| 字体 | **不随包分发任何字体**。界面和节点文字只按名字引用系统已安装的字体（Microsoft YaHei、PingFang SC、Noto Sans CJK SC、system-ui 等；代码用 Consolas / Courier New / monospace）；没有时由浏览器自动替换。 | 各字体归其权利人，本仓库不含字体文件 |
| 图标 | 按钮和节点图标是 Unicode 字符 / emoji，由操作系统自带字体渲染，本仓库不含图标图片。 | — |
| 示例地图 | 「这门课的知识树」「论文写作结构」「一周计划」三张示例的文字由作者编写（`play/js/samples.js`）。 | 同本仓库（CC BY 4.0） |
| 截图 | `docs/img/` 下的截图由 `tools/browser_check.py` / `tools/mobile_check_mindmap.py` 用本机浏览器无头截取本页面。 | CC BY 4.0（同文档） |

## 参考的公开格式与算法（只参考规范，没有复制代码）

| 用在哪里 | 出处 |
|---|---|
| OPML 导入导出 | OPML 2.0 规范（`outline` 元素的 `text` 属性；`_note` 等下划线属性是常见扩展） |
| FreeMind .mm 导入导出 | FreeMind 1.0.1 的文件格式（`map` / `node` 元素，`TEXT`、`FOLDED`、`COLOR`、`POSITION` 属性，`richcontent TYPE="NOTE"`） |
| Markdown 标题与列表 | CommonMark 的 ATX 标题和列表项写法；只实现本项目需要的子集 |
| 树状布局 | 经典的“子树块高度 = 子块之和、节点在块内居中”排版思路（Reingold–Tilford 一类分层布局的简化版） |
| 键位习惯 | 回车建同级、Tab 建子级是桌面思维导图软件的通行习惯；本项目只借用操作习惯，不含任何第三方软件的代码或素材 |

## 开发与测试工具（不随 play/ 分发）

| 工具 | 用途 | 许可证 |
|---|---|---|
| Python 3 标准库 | `tools/` 构建、截图、打包脚本 | PSF License |
| pytest | 运行 `tests/` | MIT |
| Node.js | 运行 `tests/js/unit_tests.js`、导出 `docs/examples/`（可选） | MIT（本体） |
| Playwright（Python） | 驱动本机已安装的 Microsoft Edge 做无头自检与截图（不下载任何浏览器） | Apache-2.0 |
| 本机已安装的 Microsoft Edge | 无头自检与截图 | 各自的许可 |

## 商标

本项目是一个通用的教学用思维导图编辑器，与任何商业思维导图软件及其厂商没有关联，也未获得其认可。
