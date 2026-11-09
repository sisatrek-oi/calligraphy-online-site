# OCR 工作流源码

这是书论 canonical 工作区 `tasks/2026-10-13-ocr-first100/` 的源码快照；逐文件 SHA256 见 `source-manifest.json`。恢复时将本目录下 `tasks/` 合入书论工作区，保留该相对布局。原图、OCR 权重、Python 环境和私有接口配置仍由本机工作区提供，未上传模型、密钥或机器运行缓存。它不是 GitHub Pages 上运行的服务。

标准入口为 `tasks/2026-10-13-ocr-first100/run_ocr.py`。识别后必须携带字符 ID、本候选的原图坐标／SHA 和 TXT UTF-16 对应。复核、改文、预览及导出均须保留 `character-maps/` 与 `character-map-index.json`。复识缺几何时明确未映射，不借旧框；人工调框作为独立版本层保存，不覆盖原 OCR、不继承旧确认。审核按篇章组织，原页仅作溯源。

完整运行、依赖、恢复和人工审核规则见 [工作流说明](tasks/2026-10-13-ocr-first100/reviewed-pipeline-guide.md)。正式标注只使用审核记录与正文版本一致的人工 TXT。
