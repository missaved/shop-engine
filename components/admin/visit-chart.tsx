'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// 访问趋势图（2026-08-30 访问统计增强）：近 30 天 PV/UV 双线
// 沿用 RevenueChart 的 recharts 3.x 风格；纯桌面后台卡片内使用
export function VisitChart({ data }: { data: { day: string; pv: number; uv: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#e4e4e7' }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
          />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="pv" name="PV" stroke="#f59e0b" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="uv" name="UV" stroke="#0ea5e9" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
