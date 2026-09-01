// 一次性脚本：MiniMax 文生图生成「门户城市风景 hero 图」到 public/hero/city.jpg
// 用法：node scripts/generate-hero-city.mjs <file> "<prompt>" [ratio]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
function loadEnv(){const p=resolve(__dirname,'../.env');const out={};try{for(const line of readFileSync(p,'utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)out[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{}return out}
const [file,prompt,ratio='16:9']=process.argv.slice(2)
if(!file||!prompt){console.error('用法：node scripts/generate-hero-city.mjs <file> "<prompt>" [ratio]');process.exit(1)}
const env=loadEnv();const API_KEY=env.MINIMAX_API_KEY
const BASE=API_KEY?.startsWith('sk-cp-')?'https://api.minimaxi.com/v1/image_generation':'https://api.minimax.io/v1/image_generation'
if(!API_KEY){console.error('❌ 缺少 MINIMAX_API_KEY');process.exit(1)}
;(async()=>{
  const body={model:'image-01',prompt,aspect_ratio:ratio,n:1,response_format:'base64'}
  const res=await fetch(BASE,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${API_KEY}`},body:JSON.stringify(body)})
  const json=await res.json();const b64=json.data?.image_base64?.[0]
  if(!b64)throw new Error('响应缺少 image_base64: '+JSON.stringify(json).slice(0,200))
  const buf=Buffer.from(b64,'base64')
  const outDir=resolve(__dirname,'../public/hero');mkdirSync(outDir,{recursive:true})
  writeFileSync(resolve(outDir,file+'.jpg'),buf)
  console.log(`✅ public/hero/${file}.jpg（${buf.length} bytes，${ratio}）`)
})().catch(e=>{console.error('生成失败:',e);process.exit(1)})
