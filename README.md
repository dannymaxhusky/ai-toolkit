# Reroom — AI 室内装修设计

手机端拍下房间内景，选择装修风格，AI 在几十秒内生成**同一空间**的全新设计方案。
由 Google Gemini「Nano Banana 2」图像模型驱动，部署在 Netlify，存储用 **Netlify Blobs**（零配置，无需任何数据库账号）。

> 流程：拍照 → 选风格（8 种）→ 选 1 张 / 4 张方案 → 出图 → 左右拖动对比设计前后。

---

## 架构

```
手机浏览器 (静态站点, Netlify)
   │  1. 拍照并在本地压缩到 ~1280px
   │  2. POST 图片+风格+数量 ──►  Netlify 后台函数 redesign-background
   │                                  │  Blobs(jobs):  status=processing
   │                                  │  并行调用 Gemini 生成 N 个变体(保留结构，仅换风格)
   │                                  │  Blobs(images): 存每张结果图
   │                                  │  Blobs(jobs):  status=done + 结果URL数组
   │  3. 轮询 status?id=… ◄── status 函数 ── 读 Blobs(jobs)
   │  4. 图片 <img src=/.netlify/functions/img?key=…> ◄── img 函数 ── 读 Blobs(images)
   └─ 完成后以 2×2 网格展示，点任意一张进入「设计前 / 后」对比
```

为什么用**后台函数 + 轮询**：图像生成通常需要 20–60 秒，超过普通无服务器函数 10 秒的同步超时。
后台函数（文件名以 `-background` 结尾）异步运行最长 15 分钟，结果写入 Blobs，前端轮询获取。

为什么用 **Netlify Blobs** 而不是外部数据库：我们的数据需求很简单（任务状态 JSON + 图片），
不需要 SQL。Blobs 每个站点自带、零配置、免费，同时充当键值存储和对象存储。

---

## 部署步骤

只有一步配置 + 部署：

### 1. Netlify 环境变量
站点 **Site settings → Environment variables**，添加一个变量：

| 变量名 | 值 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio 密钥（**需已开通付费**，图像模型无免费额度） |

> 不需要数据库 URL、不需要任何密钥——Netlify Blobs 会自动开通。

### 2. 部署
- 在 Netlify **Add new site → Import from Git**，选择本仓库。
- 构建设置无需改动：`publish = "."`，`functions = "netlify/functions"`（已在 [`netlify.toml`](netlify.toml) 配置）。
- Netlify 会自动为函数安装依赖 `@netlify/blobs`。
- 部署完成后用**手机**打开站点即可（拍照按钮会调用后置摄像头）。

> 套餐提醒：Netlify **后台函数**在付费套餐上最稳定。若你的套餐不支持后台函数，
> 把 `netlify/functions/redesign-background.mjs` 重命名为 `redesign.mjs`，并把前端
> `assets/app.js` 中的 `/.netlify/functions/redesign-background` 改为 `/.netlify/functions/redesign`，
> 即可改为同步调用（注意可能受 10–26 秒超时限制，4 张方案更易超时，建议改后只用 1 张）。

---

## 本地开发

```bash
npm install                  # 安装 @netlify/blobs
npm install -g netlify-cli   # 如未安装
cp .env.example .env         # 填入真实的 GEMINI_API_KEY
netlify dev                  # http://localhost:8888 （本地也会模拟 Blobs）
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

提示词位于 [`netlify/functions/redesign-background.mjs`](netlify/functions/redesign-background.mjs) 顶部的 `STYLES`，
可自由增删风格（前端 `assets/app.js` 的 `STYLES` 数组需保持 key 一致）。

## 多方案网格

生成前可选「1 张」或「4 张方案」。选 4 张时，后台函数**并行**调用 4 次 Gemini，
每次套用不同「创意方向」（见 `VARIATIONS`：中性日光 / 暖色夜晚 / 大胆布局 / 通透绿植），
得到同一房间同一风格下 4 个不同的设计，前端以 2×2 网格展示，点任意一张进入「设计前 / 后」对比。

> 成本提醒：4 张方案 = 4 次图像生成，费用约为单张的 4 倍。

---

## 技术栈
- 前端：原生 HTML / CSS / JS（无构建步骤）；Fraunces + Hanken Grotesk + Noto Sans SC 字体
- 后端：Netlify Functions（ESM，使用 Node 18+ 全局 `fetch`）
- 存储：Netlify Blobs（`jobs` 任务状态 / `images` 图片 / `meta` 最近作品）
- 模型：`gemini-3.1-flash-image-preview`（图像编辑：保留房间结构，仅替换风格）

设计灵感参考：[ReRoom](https://reroom.ai) · [Alcov](https://alcov.co) · [Interior AI](https://interiorai.com)。
