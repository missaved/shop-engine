#!/usr/bin/env python3
# 测试前重置:所有 shop.open=true(防止前一轮测试遗留打烊状态)
import subprocess, sys
script = r"""
import 'dotenv/config'
import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const a = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const p = new PrismaClient({ adapter: a })
const r = await p.shop.updateMany({ data: { open: true } })
console.log('重置', r.count, '家店为营业中')
await p.$disconnect()
"""
# 直接用 psql 不依赖 tsx
import os, psycopg2
url = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5433/shop_engine')
try:
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute("UPDATE \"Shop\" SET open = true WHERE open = false RETURNING slug")
    rows = cur.fetchall()
    conn.commit()
    print(f"重置 {len(rows)} 家店为营业中: {[r[0] for r in rows]}")
    conn.close()
except Exception as e:
    print(f"psql err: {e}, fallback tsx")
    subprocess.run(['pnpm','tsx','-e', script], cwd='/root/shop-saas/app', check=True)