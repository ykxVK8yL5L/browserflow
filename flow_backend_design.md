# Flow 自动化执行平台（Playwright + FastAPI）完整后端架构

## 技术栈
FastAPI + Playwright + SQLite + WebSocket + asyncio

---

## 一、核心模型

Flow = 流程逻辑  
Credential = 账号凭证（用于登录时的用户名密码）  
Identity = 浏览器环境/身份（决定 Session、Cookie、User-Agent 及持久化方式）  
Execution = 一次执行  

---

## 二、核心关系

Flow        1 → 1 Identity (执行时绑定)  
Credential  1 → N Identity (Identity 可由 Credential 初始化)  
Identity    1 → N Execution（需加锁，同一 Identity 不允许并发执行）  

---

## 三、整体架构

用户请求
↓
FastAPI
↓
Execution Queue
↓
Worker Pool
↓
CloakBrowser Sandbox
↓
Browser Context + Pages

---

## 四、目录结构

backend/
├── main.py
├── api/
│   ├── execute.py
│   ├── ws.py
├── core/
│   ├── queue.py
│   ├── identity_lock.py
│   ├── executor.py
│   ├── sandbox.py
├── db/
│   ├── models.py

---

## 五、队列系统

import asyncio

execution_queue = asyncio.Queue()
WORKER_COUNT = 2

---

## 六、Worker

async def worker():
    while True:
        execution = await execution_queue.get()
        try:
            await run_execution(execution)
        finally:
            execution_queue.task_done()

---

## 七、Identity 锁

identity_locks = {}

async def acquire_identity(identity_id):
    lock = identity_locks.setdefault(identity_id, asyncio.Lock())
    await lock.acquire()
    return lock

---

## 八、执行入口

@router.post("/execute")
async def execute(payload: dict):
    await execution_queue.put(payload)
    return {"status": "queued"}

---

## 九、执行逻辑

async def run_execution(execution):
    lock = await acquire_identity(execution["identity_id"])
    try:
        sandbox = ExecutionSandbox(execution)
        await sandbox.run()
    finally:
        lock.release()

---

## 十、Playwright 沙箱

class ExecutionSandbox:

    def __init__(self, execution):
        self.execution = execution
        self.pages = {}
        self.current_page = "main"

    async def run(self):
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context()

            page = await context.new_page()
            self.pages["main"] = page

            await self.execute_flow()

            await browser.close()

---

## 十一、多页面支持

self.pages = {}
self.current_page = "main"

支持：
- new_page
- switch_page

---

## 十二、Flow 执行

async def execute_flow(self):
    for node in self.execution["nodes"]:
        page = self.pages[self.current_page]

        if node["type"] == "navigate":
            await page.goto(node["url"])

        elif node["type"] == "click":
            await page.click(node["selector"])

        elif node["type"] == "type":
            await page.fill(node["selector"], node["text"])

---

## 十三、WebSocket

connections = {}

async def send_log(client_id, message):
    ws = connections.get(client_id)
    if ws:
        await ws.send_json(message)

---

## 十四、SQLite

execution(id, flow_id, identity_id, status)
identity(id, credential_id, storage_state_path)
credential(id, site, data)

---

## 十五、Identity 管理系统

### 1. Identity 类型定义
- **None (无)**: 纯净模式。不加载任何状态，不保存 Session。
- **File (文件)**: 状态快照模式。使用 `storageState` (JSON) 保存/加载 Cookie 和 LocalStorage。
- **Profile (配置文件)**: 全量持久化模式。使用 `user_data_dir` 保存完整的浏览器 Profile（含缓存、索引数据库等）。

### 2. 存储路径
所有 Identity 统一存储在：`backend/data/identities/{user_id}/{identity_id}/`

- **File**: 在该目录下存储 `state.json` (Playwright storageState)。
- **Profile**: 该目录本身即为 `user_data_dir`。

### 3. 浏览器实例创建策略
- **None**: `browser.new_context({ userAgent: config.userAgent })`
- **File**: `browser.new_context({ storageState: "backend/data/identities/{user_id}/{identity_id}/state.json", userAgent: config.userAgent })`
- **Profile**: `launch_persistent_context(user_data_dir="backend/data/identities/{user_id}/{identity_id}/", headless=config.headless, userAgent=config.userAgent)`

### 4. 管理功能
- **CRUD**: 创建、编辑、删除 Identity 配置。
- **上传**: 支持上传 `storageState` JSON 文件，自动创建 "File" 类型 Identity。
- **文件管理**: 允许用户删除关联的物理文件夹。
- **配置项**: `headless` (是否无头), `userAgent` (自定义 UA)。

---

## 十六、执行流程

1. 入队
2. worker 执行
3. identity 加锁
4. 根据 Identity 类型启动浏览器实例
5. 执行 flow
6. 保存状态 (如果是 File 类型)
7. 释放锁

---

## 十七、关键原则

- Flow 串行
- Execution 可并发（队列控制）
- Identity 必须加锁
- 每个执行独立 context


## 十七、总结

自动化执行引擎 + 多账号系统 + 队列调度
