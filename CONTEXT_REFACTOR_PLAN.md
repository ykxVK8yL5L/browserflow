# Context 化执行器重构计划

## 背景

当前 DSL 执行链路主要依赖：

- `edges` 表示控制流
- `data.inputs` + `outputs` 表示数据引用
- `resolve_locator_target(...)` 在需要时重新基于 `page` 和参数构建 locator

这会导致一个核心问题：

> 节点之间没有真正的运行时 `context` 传递，很多节点是在“重新执行查询”，而不是“消费上一个节点的运行时结果”。

典型表现：

- `all -> first -> innerText` 不是链式消费，而是多次重新解析 locator
- 不填 `selector` 时，很多节点无法稳定执行
- 即使前面做了 `first` / `nth`，后面的读取节点仍可能触发 strict mode
- `foreach` 中的当前项语义不够稳定
- `target` 与 `selector` 的优先级和职责不够清晰

---

## 重构目标

引入真正的运行时上下文模型，使节点执行更接近 Playwright DSL 的链式语义：

```python
page.locator(".movie-list a").first.inner_text()
```

目标包括：

1. 节点执行结果写入运行时 `context`
2. 后续节点优先从 `context` 读取上游结果
3. `first` / `last` / `nth` / `innerText` 等节点不再默认重新从 `page` 查询
4. `selector` 只作为起点定位或显式覆盖手段，不再成为每个节点的必填项
5. 保持对当前 `{ nodes, edges }` 结构和 legacy 数据的兼容

---

## 核心设计

### 1. 区分两类结果

建议将运行时结果拆成两层：

#### A. `runtime context`
保存不可序列化的运行时对象，例如：

- Playwright `Page`
- Playwright `Locator`
- `Locator.first` / `Locator.nth(...)` 结果
- `foreach` 当前 item
- 中间运行时对象

示意：

```python
context.values[node_id] = runtime_value
```

#### B. `serialized outputs`
保存可序列化结果，用于：

- WebSocket 推送
- 前端展示
- 执行日志
- 条件判断 / 文本插值 / 调试

示意：

```python
context.outputs[node_id] = serialized_output
```

---

### 2. 推荐的上下文结构

建议新增统一的数据结构，例如：

```python
class ExecutionContext:
    page: Any
    pages: dict[str, Any]
    values: dict[str, Any]
    outputs: dict[str, Any]
    locals: dict[str, Any]
```

各字段建议职责：

- `page`: 当前页面
- `pages`: 多页面场景下的页面集合
- `values`: 每个节点的运行时值
- `outputs`: 每个节点的序列化输出
- `locals`: 局部变量，如 `foreach.item`

---

### 3. 节点执行优先级

后续节点取值建议遵循以下优先级：

1. **显式 `inputs.from`** → 从 `context.values` / `context.locals` 获取运行时对象
2. **若拿不到运行时对象** → 再尝试从 `context.outputs` 获取序列化值
3. **若仍无可用输入** → 再回退到 `params.selector` / `params.*`

这意味着：

- `target` 优先代表“已有上下文对象”
- `selector` 是“新建定位上下文”的入口
- 读取类节点不应优先重新查 DOM

---

## 节点语义建议

### 1. 定位类节点

#### `locator`
- 输入：`selector` 或已有 `target`
- 输出：新的运行时 `Locator`
- 序列化输出：可选 descriptor + 调试信息

#### `all`
推荐语义二选一：

方案 A：
- `values[node_id] = locator`
- `outputs[node_id] = { count }`
- 后续 `first/last/nth` 直接在 locator 上继续链式操作

方案 B：
- `values[node_id] = [locator.nth(0), locator.nth(1), ...]`
- `outputs[node_id] = { count, items }`

当前更推荐 **方案 A**，因为更接近 Playwright 语义，也更省运行时复杂度。

#### `first` / `last` / `nth`
- 输入：上游 locator 或 locator 集合
- 输出：新的单元素 locator
- 不应该重新依赖 `page.locator(selector)`

---

### 2. 读取类节点

例如：

- `innerText`
- `textContent`
- `inputValue`
- `getAttribute`
- `isVisible`
- `isEnabled`
- `isChecked`

建议语义：

- 若存在上游 `target` / `current`，直接对其执行读取
- 只有没有上游输入时，才回退到 `selector`

例如：

```python
locator = context.values[ref]
value = await locator.inner_text()
```

而不是：

```python
locator = page.locator(selector)
value = await locator.inner_text()
```

---

### 3. 动作类节点

例如：

- `click`
- `hover`
- `fill`
- `type`
- `press`
- `check`
- `uncheck`
- `selectOption`

建议与读取类保持一致：

- 优先消费运行时 target
- 无 target 时再根据 selector 创建 locator

---

### 4. 流程控制节点

#### `foreach`
每一轮建议建立局部上下文：

```python
context.locals[item_name] = current_item
```

子节点优先从局部上下文取值。

#### `if`
条件输入优先从 `context.outputs` 读取序列化值；若条件本身依赖运行时对象，需要先通过读取节点转换成可判断值。

#### `map`
建议主要作用于可序列化数据，不直接面向 Playwright runtime 对象。

---

## 兼容策略

为了不一次性推翻现有代码，建议分阶段兼容。

### 阶段 1：引入 `context.values`
- 保留现有 `outputs`
- 在节点执行后额外保存 runtime value
- `resolve_input_value(...)` 支持优先读取 runtime value

### 阶段 2：重写 `resolve_locator_target(...)`
当前函数主要做“把参数重新构造成 locator”。

后续建议改为：

- 优先从 `context.values` 拿 locator
- 若输入是 runtime locator，则直接返回
- 若输入是 descriptor，再作为兼容回退处理
- 最后才根据 `selector` 新建 locator

### 阶段 3：改造关键节点
优先改这些节点：

1. `locator`
2. `all`
3. `first`
4. `last`
5. `nth`
6. `innerText`
7. `textContent`
8. `getAttribute`
9. `click`
10. `foreach`

### 阶段 4：弱化 descriptor 依赖
逐步把当前 `locator_ref` 从“主通路”降级为“兼容通路 / 调试输出”。

---

## 对现有代码的主要改动点

### 1. `backend/core/executor.py`
需要：

- 增加统一的 runtime context 存储
- 节点执行完成后同时写入：
  - `context.values[node_id]`
  - `context.outputs[node_id]`
- `foreach` 执行时传递局部上下文，而不只是 `extra_outputs`

### 2. `backend/core/node_handlers/common.py`
需要：

- 改造 `resolve_input_value(...)`
- 改造 `resolve_store_reference(...)`
- 重写 `resolve_locator_target(...)`
- 允许引用 runtime 对象，而不是只引用序列化结果

### 3. `backend/core/node_handlers/browser.py`
需要：

- `all` / `first` / `last` / `nth` 直接返回 runtime locator 或 locator collection
- `innerText` / `textContent` / `getAttribute` 优先消费 runtime locator
- 动作类节点不再默认依赖 selector

### 4. `backend/core/node_handlers/flow_control.py`
需要：

- `foreach` 建立局部上下文
- `map` 与 `if` 区分 runtime 值与 serialized 值的使用场景

---

## 建议的阶段性实施顺序

### 第一步：打基础
- 引入 `ExecutionContext.values`
- 为执行器增加 runtime value 写入逻辑
- 不改变前端协议

### 第二步：先修 locator 链
- 改 `locator` / `all` / `first` / `last` / `nth`
- 保证 `all -> first -> innerText` 这类链路成立

### 第三步：修读写节点
- 改 `innerText` / `textContent` / `getAttribute` / `click`
- 让“有 target 就可不填 selector”真正成立

### 第四步：修 `foreach`
- 为每轮 item 注入局部 context
- 支持 `foreach -> innerText/getAttribute/click` 稳定工作

### 第五步：清理前端默认值干扰
- 让前端不再默认持久化无意义 selector
- 减少 selector/target 混用导致的歧义

---

## 验收用例

重构后至少应通过以下场景：

### 用例 1：链式单元素读取
- `locator(.movie-list a)`
- `first(target=locator.result)`
- `innerText(target=first.result)`

预期：
- 不需要重复填写 selector
- 不触发 strict mode

### 用例 2：链式属性读取
- `locator(.movie-list a)`
- `first`
- `getAttribute(attribute=href)`

预期：
- 能读到第一个链接的 `href`

### 用例 3：批量遍历
- `all(.movie-list a)`
- `foreach(items=all.result, itemName=item)`
- `innerText(target=item)`

预期：
- 每轮都基于当前 item 读取文本

### 用例 4：动作链
- `locator(.movie-list a)`
- `first`
- `click`

预期：
- `click` 直接消费 `first` 的运行时结果

---

## 风险与注意事项

1. **Playwright 对象不可序列化**
   - 只能放在 runtime context，不能直接发前端

2. **运行时对象生命周期**
   - 页面跳转、页面关闭后，旧 locator 可能失效
   - 需要明确 locator 的生命周期边界

3. **兼容老 flow**
   - 老配置仍可能只提供 selector
   - 必须保留 selector fallback

4. **`map` 不宜直接处理 runtime locator**
   - 否则表达式系统会更复杂
   - 更适合作用于序列化值

---

## 结论

下一轮实施应以“引入 runtime context 并让节点优先消费上游运行时结果”为主线。

核心原则：

- `selector` 负责创建上下文
- `target` 负责传递上下文
- `outputs` 负责展示结果
- `values` 负责运行时链式执行

这样才能把当前执行器从“多次独立查询”逐步演进为“真正的 DSL 上下文执行器”。

---

## 暂定实施前检查清单

- [ ] 明确 `ExecutionContext` 结构
- [ ] 明确 `values` 与 `outputs` 的职责边界
- [ ] 设计 `resolve_input_value(...)` 的新优先级
- [ ] 设计 `all` 的 runtime 返回模型
- [ ] 设计 `foreach.locals` 注入方式
- [ ] 选定第一批改造节点
- [ ] 准备最小回归测试 flow
- [ ] 保留 legacy selector fallback
","explanation":"创建一份 context 化执行器重构规划文档，记录后续实施方向与阶段任务。