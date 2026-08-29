-- 第 20 批补录：User.username（admin 登录用户名）
-- 该列已存在于库中（当时手工 ALTER 未记入迁移历史，导致 migrate 检测漂移）。
-- 用 IF NOT EXISTS 幂等补录，避免重建库 / 丢数据
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
