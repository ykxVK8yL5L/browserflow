# Playwright DSL 设计文档

## 一、Playwright API 分类（带输入 / 输出类型）

### 1️⃣ Locator 生成类（核心入口）

作用：生成元素引用（不会执行）

| 方法 | 输入 | 输出 |
|------|------|------|
| page.locator(selector) | string | Locator |
| locator.locator(selector) | string | Locator |
| getByText(text) | string | Locator |
| getByRole(role) | string | Locator |
| getByTestId(id) | string | Locator |
| nth(index) | number | Locator |
| first() | - | Locator |
| last() | - | Locator |
| filter(options) | object | Locator |

---

### 2️⃣ 查询类（纯读取）

不会改变页面，只返回数据

| 方法 | 输入 | 输出 |
|------|------|------|
| textContent() | - | string | null |
| innerText() | - | string |
| inputValue() | - | string |
| getAttribute(name) | string | string | null |
| isVisible() | - | boolean |
| isEnabled() | - | boolean |
| isChecked() | - | boolean |
| count() | - | number |

页面级：

| 方法 | 输出 |
|------|------|
| page.title() | string |
| page.url() | string |

---

### 3️⃣ 操作类（副作用）

执行动作，不返回值

| 方法 | 输入 | 输出 |
|------|------|------|
| click() | - | void |
| fill(value) | string | void |
| type(text) | string | void |
| press(key) | string | void |
| check() | - | void |
| uncheck() | - | void |
| hover() | - | void |
| selectOption() | value | void |

页面级：

| 方法 | 输入 |
|------|------|
| goto(url) | string |
| reload() | - |

---

### 4️⃣ 等待类

| 方法 | 输出 |
|------|------|
| waitFor() | void |
| waitForSelector() | ElementHandle |
| waitForLoadState() | void |
| waitForURL() | void |

---

### 5️⃣ 集合 / 高阶类（关键）

| 方法 | 输出 |
|------|------|
| locator.count() | number |
| locator.all() | Locator[] |
| evaluateAll(fn) | any[] |

示例：

```ts
await locator.evaluateAll(els => els.map(e => e.textContent))
```

输出：

```ts
string[]
```

---

## 二、统一类型系统（DSL 核心）

```ts
type Value =
  | string
  | number
  | boolean
  | null
  | object
  | Value[]

type FlowType =
  | 'void'
  | 'locator'
  | 'locator[]'
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
```

---

## 三、DSL 基础结构

```ts
type Node = {
  id: string
  type: string
  inputs?: Record<string, InputRef>
  params?: Record<string, any>
  outputType: FlowType
}

type InputRef =
  | { from: string }
  | { value: any }
```

---

## 四、DSL 节点设计

### locator 节点

```json
{
  "id": "btns",
  "type": "locator",
  "params": {
    "selector": "button"
  },
  "outputType": "locator"
}
```

---

### count 节点

```json
{
  "id": "btnCount",
  "type": "count",
  "inputs": {
    "target": { "from": "btns" }
  },
  "outputType": "number"
}
```

---

### click 节点

```json
{
  "id": "clickFirst",
  "type": "click",
  "inputs": {
    "target": { "from": "btns" }
  },
  "params": {
    "index": 0
  },
  "outputType": "void"
}
```

---

### all 节点

```json
{
  "id": "btnList",
  "type": "all",
  "inputs": {
    "target": { "from": "btns" }
  },
  "outputType": "locator[]"
}
```

---

### foreach 节点

```json
{
  "id": "loopBtns",
  "type": "foreach",
  "inputs": {
    "items": { "from": "btnList" }
  },
  "params": {
    "itemName": "btn"
  }
}
```

子流程：

```json
{
  "type": "click",
  "inputs": {
    "target": { "from": "btn" }
  }
}
```

---

### map 节点

```json
{
  "id": "texts",
  "type": "map",
  "inputs": {
    "items": { "from": "btnList" }
  },
  "params": {
    "fn": "el => el.textContent"
  },
  "outputType": "array"
}
```

---

### if 节点

```json
{
  "id": "hasBtns",
  "type": "if",
  "inputs": {
    "condition": { "from": "btnCount" }
  },
  "params": {
    "operator": ">",
    "value": 0
  }
}
```

---

## 五、执行模型

```ts
type ExecutionContext = {
  store: Record<string, any>
}

const result = await runNode(node, ctx)
ctx.store[node.id] = result

function resolve(input, ctx) {
  if (input.from) return ctx.store[input.from]
  return input.value
}
```

---

## 六、最小可用节点集

- locator
- count
- click
- all
- foreach
- if

---

## 七、完整示例

```json
[
  {
    "id": "btns",
    "type": "locator",
    "params": { "selector": "button" },
    "outputType": "locator"
  },
  {
    "id": "btnList",
    "type": "all",
    "inputs": {
      "target": { "from": "btns" }
    },
    "outputType": "locator[]"
  },
  {
    "id": "loop",
    "type": "foreach",
    "inputs": {
      "items": { "from": "btnList" }
    },
    "params": {
      "itemName": "btn"
    }
  }
]
```

---

## 八、总结

- 使用 ExecutionContext 解决数据覆盖
- 明确 inputs / outputType
- 支持集合与流程控制（foreach / map）
