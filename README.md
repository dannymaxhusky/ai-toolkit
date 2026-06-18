# Reroom — AI 室内装修设计

手机端拍下房间内景，选择装修风格，AI 在几十秒内生成**同一空间**的全新设计方案。
由 Google Gemini「Nano Banana 2」图像模型驱动，部署在 Netlify，数据存储在 Supabase。

> 截图：拍照 → 选风格（现代简约 / 北欧 / 工业风 / 日式侘寂）→ 左右拖动对比设计前后。

---

## 架构

```
手机浏览器 (静态站点, Netlify)
   │  1. 拍照并在本地压缩到 ~1280px
   │  2. POST 图片+风格  ──────────────►  Netlify 后台函数 redesign-background
   │                                          │  写入 Supabase: status=processing
   │                                          │  上传原图到 Storage
   │                                          │  调用 Gemini 图像编辑(保留结构，仅换风格)
   │                                          │  上传结果图，status=done
   │  3. 轮询 status?id=… ◄── Netlify 函数 status ── 读取 Supabase
   └─ 完成后展示「设计前 / 设计后」对比滑块
```

> 为什么用**后台函数 + 轮询**：图像生成通常需要 20–40 秒，超过普通无服务器函数 10 秒的同步超时。
> 后台函数（文件名以 `-background` 结尾）异步运行最长 15 分钟，结果写入 Supabase，前端轮询获取。

---

## 部署步骤

### 1. Supabase
1. 打开你的 Supabase 项目 → **SQL Editor** → 粘贴并运行 [`supabase/schema.sql`](supabase/schema.sql)。
   - 它会创建 `redesigns` 表，并创建一个公开读取的 `rooms` 存储桶。
2. 到 **Project Settings → API**，记下：
   - **Project URL**（形如 `https://xxxx.supabase.co`）
   - **service_role** 密钥（机密，仅服务端使用）

### 2. Netlify 环境变量
站点 **Site settings → Environment variables**，添加三个变量：

| 变量名 | 值 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio 密钥（**需已开通付费**，图像模型无免费额度） |
| `SUPABASE_URL` | 上面的 Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 上面的 service_role 密钥 |

> ⚠️ 如果你的 Netlify 已通过官方 Supabase 扩展绑定，注入的可能只是数据库连接串（`SUPABASE_DATABASE_URL`）。
> 本应用走 REST/Storage，所以**仍需手动添加** `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 两项。

### 3. 部署
- 在 Netlify **Add new site → Import from Git**，选择本仓库。
- 构建设置无需改动：`publish = "."`，`functions = "netlify/functions"`（已在 [`netlify.toml`](netlify.toml) 中配置）。
- 部署完成后用**手机**打开站点即可（拍照按钮会调用后置摄像头）。

> 关于套餐：Netlify 后台函数在付费套餐上最稳定。若你的套餐不支持后台函数，
> 把 `netlify/functions/redesign-background.js` 重命名为 `redesign.js`，并把前端
> `assets/app.js` 中的 `/.netlify/functions/redesign-background` 改为 `/.netlify/functions/redesign`，
> 即可改为同步调用（注意可能受 10–26 秒超时限制）。

---

## 本地开发

```bash
npm install -g netlify-cli   # 如未安装
cp .env.example .env         # 填入真实密钥
netlify dev                  # http://localhost:8888
```

---

## 八种装修风格

| 风格 | 说明 |
|---|---|
| 现代简约 Modern Minimalist | 干净线条、中性色、低矮家具、隐藏收纳 |
| 北欧风 Scandinavian | 浅色橡木、白墙、温暖织物、绿植 |
| 工业风 Industrial Loft | 裸砖、水泥、黑色金属、皮革、爱迪生灯泡 |
| 日式侘寂 Japandi | 低矮木家具、天然材质、素雅大地色 |
| 轻奢风 Modern Luxury | 大理石、黄铜、丝绒、金色点缀，五星级酒店感 |
| 中古风 Mid-Century Modern | 胡桃木、细腿家具、复古撞色 |
| 法式 French Parisian | 石膏线、人字拼地板、复古家具，优雅浪漫 |
| 波西米亚 Bohemian | 藤编、织物、绿植、大地色，自由随性 |

提示词位于 [`netlify/functions/redesign-background.js`](netlify/functions/redesign-background.js) 顶部的 `STYLES`，
可自由增删风格（前端 `assets/app.js` 的 `STYLES` 数组需保持 key 一致）。

## 多方案网格

可在生成前选择「1 张」或「4 张方案」。选 4 张时，后台函数会**并行**调用 4 次 Gemini，
每次套用不同的「创意方向」（见 `VARIATIONS`：中性日光 / 暖色夜晚 / 大胆布局 / 通透绿植），
得到同一房间同一风格下 4 个不同的设计，前端以 2×2 网格展示，点任意一张进入「设计前 / 后」对比。
所有结果 URL 存入 `redesigns.results`（jsonb 数组），封面存 `result_url`。

> 成本提醒：4 张方案 = 4 次图像生成，费用约为单张的 4 倍。

---

## 技术栈
- 前端：原生 HTML / CSS / JS（无构建步骤）；Fraunces + Hanken Grotesk + Noto Sans SC 字体
- 后端：Netlify Functions（零依赖，使用 Node 18+ 全局 `fetch`）
- 模型：`gemini-3.1-flash-image-preview`（图像编辑：保留房间结构，仅替换风格）
- 存储：Supabase Postgres + Storage

设计灵感参考：[ReRoom](https://reroom.ai) · [Alcov](https://alcov.co) · [Interior AI](https://interiorai.com) · [ReimagineHome]。
