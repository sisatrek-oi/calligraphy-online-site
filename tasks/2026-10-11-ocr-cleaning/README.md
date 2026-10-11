# 《历代书法论文选》全书 OCR 清洗结果

- `full-book-conservative.txt`：保守校验版，尽量只改高度确定的识别错误、标点和断行。
- `full-book-normalized.txt`：语义整理版，按前后页和书法史语境整理断行与标点。
- `full-book-uncertainties.jsonl`：模型无法确认的字词和处理理由。
- `full-book-contextual.jsonl`：逐页结构化结果，含两版正文和不确定项。

原始 OCR 位于 `screening-data/part-1-ocr.txt` 至 `part-4-ocr.txt`，本次处理没有覆盖原始文件。结果按物理页 1–1052 完整覆盖；部分后段批次在主模型额度达到限制后由备用模型续跑，规则保持一致。两版均为模型辅助校验结果，疑难字仍需对照扫描页复核。
