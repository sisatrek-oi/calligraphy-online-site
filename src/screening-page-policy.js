// Explicitly checked against the original scans; never infer deletion from OCR keywords.
export const excludedPages = Object.freeze({
  1: '封面', 2: '扉页', 3: '版权页', 4: '编印信息',
  7: '目录', 8: '目录', 9: '目录', 10: '目录', 11: '目录', 12: '目录',
  1052: '封底',
});
export const isTaskPage = number => !Object.hasOwn(excludedPages, number);
export const taskPageCount = (start, end) => end - start + 1 - Object.keys(excludedPages).map(Number).filter(n => n >= start && n <= end).length;
export const taskOcrHref = part => `./screening-data/part-${part}-${part === 1 || part === 4 ? 'task-ocr' : 'ocr'}.txt`;
