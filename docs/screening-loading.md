# 校勘材料按需加载

`npm run build:screening` 从原有 `part-N.json`、OCR、layout 与 contextual 文件生成 `part-N-index.json` 及 `materials/` 中每 16 页一个的材料块。原始文件仍用于材料下载和可追溯回归。

修改源材料后必须重新生成，提交新索引与新块，并更新 `src/screening.js` 的索引版本参数。块名包含内容哈希，旧块可保留兼容已打开的旧页面。

首屏只等索引及当前页所在块；跨块翻页成功后才切换当前页。导出 TXT、校验表或修改率汇总前，以最多三个并发请求补齐全部块，失败不生成文件。材料只写到内存页对象，不写入用户 reviews；进度保存仍沿用原本 localStorage 键。

请求超时覆盖下载正文与 JSON 解析；超时或失败后不缓存 rejected Promise，允许重试。浏览器缓存遵循服务器响应头，块文件内容哈希确保新内容使用新 URL。
