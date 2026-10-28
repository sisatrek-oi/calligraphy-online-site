// Published task 2/3 responsibility follows the user-authorized member order.
// This is separate from proofreading ranges and local chapter-plan overrides.
export const taskBatchOwners=Object.freeze([
 ['A',1,'肖源'],['B',2,'郑雨荻'],['C',3,'宋品宣'],
 ['D',4,'帅睿'],['E',5,'尹正荣'],['F',6,'姜淼'],['G',7,'彭鹏'],
].map(([batch,memberId,name])=>Object.freeze({batch,memberId,name})));
export const batchOwner=id=>taskBatchOwners.find(p=>p.batch===id)||null;
