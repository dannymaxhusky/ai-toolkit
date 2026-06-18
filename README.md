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
站点 **Site settings → Environment variables**：

| 变量名 | 是否必填 | 值 |
|---|---|---|
| `GEMINI_API_KEY` | Google 模型必填 | Google AI Studio 密钥（**需已开通付费**） |
| `SEEDANCE_API_KEY` | Seedance 模型必填 | seedance2.ai 的 Bearer 令牌（`sk_live_...`） |

可选(仅当 seedance2.ai 的图片接口与默认不符时再设)：
`SEEDANCE_API_BASE`（默认 `https://api.seedance2.ai`）、
`SEEDANCE_IMAGE_ENDPOINT`（默认 `/v1/images/generations`）、
`SEEDANCE_IMAGE_MODEL`（默认 `seedream-4-0`）。

> 只用 Google 就只配 `GEMINI_API_KEY`；两个模型都想要就两个都配。数据库无需配置——Netlify Blobs 自动开通。

> ⚠️ **Seedance 接口说明**：`api.seedance2.ai` 公开文档只有**视频**接口,图片(Seedream)接口未公开。
> 代码按其视频接口的模式（异步 `taskId` + 轮询 `/v1/tasks/:id`）做了适配,并把字段做成可用环境变量覆盖。
> 若你的账号图片接口路径/模型名不同,改上面三个可选变量即可,无需改代码；真实报错也会显示在失败提示里。

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

## 换地面瓷砖

拍照后可开启「更换地砖」:
- **选瓷砖**:内置 6 种图案(大理石/木纹/六角砖/水磨石/灰砖/花砖,在 `assets/tiles/`),也可上传单/多张自己的瓷砖(最多 4 种)。
- **应用到**(可多选):`新装修设计`(套用到主设计)/ `原始照片`(只换地砖、其它完全不变)。
- 仅勾「原始照片」时不做整体重设计,只在原图上换地砖,更快更省。

换砖用 Gemini 多图编辑(房间图 + 瓷砖图),因此**需要 `GEMINI_API_KEY`**(即使主设计选了 Seedance)。结果图在网格里以「原图·木纹」「设计·花砖」等标签区分。

## 生成引擎 & 进度条

当前 UI 只用 **Google（Gemini / Nano Banana）**——房间改造和换地砖都是「保结构的图像编辑」,Gemini 最合适,已验证可用。

> 后端仍保留了一个 provider 适配层(`provider: "google" | "seedance"`)和 Seedance 适配代码,但 UI 已隐藏 Seedance 选项,因为 seedance2.ai 没有可用的图片接口、MiniMax 的图生图只是人物主体参考(不适合房间编辑)。若以后拿到可用的「保结构图生图」接口,可在 `redesign-background.mjs` 里接上并恢复选择器。

生成过程中弹窗显示**进度条**:随耗时平滑推进,并以后台实时进度(每完成一张)为下限,完成时填满到 100%。

## 成本与画质（经济模式）

生成区有 **经济 / 高清** 切换(默认经济):
- **经济** — 用初代 `gemini-2.5-flash-image`(1K),每张约 **$0.039**,比 NB2 便宜约 40%。房间预览够用。
- **高清** — 用 `gemini-3.1-flash-image-preview`(NB2),细节/文字渲染更好,约 **$0.067/张**。

其它降本点:上传图压到 **1024px**(减少输入 token);历史可重开(不用重复生成);瓷砖只套主设计(不×4)。
想再省可把生成数量从「4 张」改为「1 张」(直接省 75%)。

> 注:512 分辨率仅 NB2 支持,无法与 2.5 Flash 叠加;而 2.5 Flash@1K 已比 NB2@512 便宜,故经济模式用 2.5 Flash@1K。

---

## 技术栈
- 前端：原生 HTML / CSS / JS（无构建步骤）；Fraunces + Hanken Grotesk + Noto Sans SC 字体
- 后端：Netlify Functions（ESM，使用 Node 18+ 全局 `fetch`）
- 存储：Netlify Blobs（`jobs` 任务状态 / `images` 图片 / `meta` 最近作品）
- 模型：`gemini-3.1-flash-image-preview`（图像编辑：保留房间结构，仅替换风格）

设计灵感参考：[ReRoom](https://reroom.ai) · [Alcov](https://alcov.co) · [Interior AI](https://interiorai.com)。
