-- M3 遗留修复：提取任务幂等键纳入材料包（正文 + 附件集合）指纹。
-- 新增可空列：队列路径逐快照抽取不涉及材料包，保持 NULL；
-- 手动链路含附件时写入材料包指纹，附件变化 → 指纹变化 → 新幂等键 → 新 run。
ALTER TABLE "extraction_runs" ADD COLUMN "material_fingerprint" TEXT;
