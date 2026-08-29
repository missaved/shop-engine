'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// 营收趋势图（第 20 批阶段五，recharts 3.x）：近 30 天按日营收
// 纯桌面后台卡片内使用；浅色主题为主（后台灰白底）
export function RevenueChart({ data }: { data: { day: string; total: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#e4e4e7' }}
          />
          <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#revenueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
