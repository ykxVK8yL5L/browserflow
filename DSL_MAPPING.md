# Playwright DSL 与 BrowserFlow JSON 映射说明

本文档说明如何把 `playwright-dsl.md` 中的节点式 DSL，映射到当前 BrowserFlow 使用的 `{ nodes, edges }` 结构里，并保持对现有 flow 数据的兼容。

## 1. 两种结构的关系

Playwright DSL 的最小结构是一个节点数组：

```json
[
  {
    "id": "btns",
    "type": "locator",
    "params": { "selector": "button" },
    "outputType": "locator"
  },
  {
    "id": "btnCount",
    "type": "count",
    "inputs": {
      "target": { "from": "btns" }
    },
    "outputType": "number"
  }
]
```

BrowserFlow 当前保存的是 React Flow 风格结构：

```json
{
  "nodes": [...],
  "edges": [...]
}
```

落地后的设计是：

- `nodes[].data.nodeType` 对应 DSL 的 `type`
- `nodes[].data.params` 对应 DSL 的 `params`
- `nodes[].data.inputs` 对应 DSL 的 `inputs`
- `nodes[].data.outputType` 对应 DSL 的 `outputType`
- `edges` 继续承担控制流和分支流转
- `nodes[].data` 中保留部分 legacy 平铺字段，兼容旧代码与旧数据

也就是说：**DSL 是逻辑模型，BrowserFlow JSON 是带画布信息的运行/编辑模型。**

---

## 2. 核心映射规则

### DSL 节点

```json
{
  "id": "btns",
  "type": "locator",
  "params": { "selector": "button" },
  "outputType": "locator"
}
```

### BrowserFlow 节点

```json
{
  "id": "btns",
  "type": "locator",
  "position": { "x": 120, "y": 120 },
  "data": {
    "label": "Buttons",
    "nodeType": "locator",
    "captureScreenshot": false,
    "screenshotTiming": "after",
    "params": { "selector": "button", "selectorType": "css" },
    "inputs": {},
    "outputType": "locator",
    "selector": "button",
    "selectorType": "css"
  }
}
```

### 字段对应关系

| DSL 字段 | BrowserFlow 字段 | 说明 |
|---|---|---|
| `id` | `node.id` | 节点唯一标识 |
| `type` | `node.type` + `node.data.nodeType` | 前端画布类型与后端执行类型统一使用同名值 |
| `params` | `node.data.params` | DSL 参数容器 |
| `inputs` | `node.data.inputs` | DSL 输入引用容器 |
| `outputType` | `node.data.outputType` | 输出类型声明 |
| 无 | `node.position` | 仅画布展示需要 |
| 无 | `node.data.label` | 仅 UI 展示需要 |
| 无 | `node.data.captureScreenshot` | BrowserFlow 执行附加配置 |
| 无 | `node.data.screenshotTiming` | 自动截图时机：`before` / `after` / `failure` |
| legacy 平铺字段 | `node.data.xxx` | 与旧节点兼容 |

---

## 3. 数据流与控制流如何拆分

在原始 DSL 里：

- `inputs` 负责声明“我依赖谁的输出”
- 节点顺序通常隐含执行顺序

在 BrowserFlow 里，这两件事被拆成两层：

### 3.1 数据流：放在 `data.inputs`

例如：

```json
"inputs": {
  "target": { "from": "node_locator" }
}
```

或引用某个节点输出字段：

```json
"inputs": {
  "condition": { "from": "node_count.result" }
}
```

### 3.2 控制流：放在 `edges`

例如：

```json
{
  "id": "e_locator_count",
  "source": "node_locator",
  "target": "node_count"
}
```

这表示执行器会在 `node_locator` 之后继续调度 `node_count`。

因此当前项目的约定是：

- **`inputs` 解决“数据从哪来”**
- **`edges` 解决“接下来执行谁”**

---

## 4. `InputRef` 在 BrowserFlow 中的写法

DSL 中：

```ts
type InputRef =
  | { from: string }
  | { value: any }
```

在 BrowserFlow 中直接落到 `node.data.inputs`：

```json
{
  "inputs": {
    "target": { "from": "node_locator" },
    "fallback": { "value": "default text" }
  }
}
```

支持的常见引用形式：

- `nodeId`：引用节点主输出
- `nodeId.result`：引用节点 `result`
- `nodeId.items`：引用列表类输出
- `btn`：在 `foreach` 中引用迭代别名
- `${nodeId.result}`：模板形式引用
- `prefix-${nodeId.result}-suffix`：模板混合文本

补充说明：

- `inputs.xxx.from` 现在既支持裸引用，也支持模板字符串
- 裸引用适合传递原始对象、数组、locator、布尔值、数字等
- 混合文本会在解析后变成字符串

示例：

```json
{
  "inputs": {
    "value": { "from": "message" },
    "target": { "from": "node_locator" },
    "summary": { "from": "验证码：${code}" }
  }
}
```

### 4.1 `nodeId` 和 `nodeId.result` 该怎么选

规则如下：

- **用 `nodeId`**：当你要传递一个节点的**整个输出对象**时。
- **用 `nodeId.result`**：当你只要这个节点输出里的 **`result` 字段**时。

当前后端解析 `from` 的方式是：

- `nodeId` 会返回该节点完整输出，即 `outputs[nodeId]`
- `nodeId.result` 会返回 `outputs[nodeId]["result"]`
- `nodeId.items` 会返回 `outputs[nodeId]["items"]`

也就是说：

- `nodeId` 适合传递 **locator / locator 集合 / 复杂结构对象**
- `nodeId.result` 适合传递 **字符串 / 数字 / 布尔值 / 最终值**

#### 场景 1：`target` 一般优先用 `nodeId`

例如 `all` 节点的输出通常是：

```json
{
  "result": [...],
  "items": [...],
  "count": 40
}
```

这时如果下游节点要继续把它当作 locator 集合来消费，推荐写：

```json
{
  "inputs": {
    "target": { "from": "node_all" }
  }
}
```

而不是优先写成：

```json
{
  "inputs": {
    "target": { "from": "node_all.result" }
  }
}
```

因为当前执行器已经支持从整个输出对象中识别 `items` / `result`，并继续解析为 locator 列表。

适合直接使用 `nodeId` 的典型场景：

- `first` / `last` / `nth` 的 `target`
- `foreach` 的集合输入
- 其他需要保留完整结构的节点输入

#### 场景 2：普通值传递优先用 `nodeId.result`

例如 `innerText` 节点输出可能是：

```json
{
  "result": "提交",
  "innerText": "提交"
}
```

如果下游只是想拿这个字符串，就推荐写：

```json
{
  "inputs": {
    "text": { "from": "node_text.result" }
  }
}
```

而不是传整个对象：

```json
{
  "inputs": {
    "text": { "from": "node_text" }
  }
}
```

适合使用 `nodeId.result` 的典型场景：

- `fill.text`
- `type.text`
- `if.condition`
- 需要数字、字符串、布尔值的普通输入

#### 场景 3：需要明确字段时用具体字段路径

如果你明确需要某个结构字段，也可以直接写完整路径：

- `node_count.result`
- `node_all.items`
- `node_url.url`

这种写法适合你已经清楚上游节点输出结构，并且只想取其中一个字段。

#### 推荐约定

为了减少歧义，建议统一遵守下面的约定：

- **传 locator、locator 列表、复杂对象：用 `nodeId`**
- **传最终值：用 `nodeId.result`**
- **只在确实需要特定字段时，才写 `nodeId.xxx`**

---

## 5. 为什么保留 legacy 平铺字段

为了兼容旧版节点数据，当前节点通常同时保留两份信息：

```json
{
  "data": {
    "nodeType": "locator",
    "params": {
      "selector": "button",
      "selectorType": "css"
    },
    "inputs": {},
    "outputType": "locator",
    "selector": "button",
    "selectorType": "css"
  }
}
```

其中：

- `params.selector` 是 DSL 风格字段
- `selector` 是 legacy 字段

后端会先通过兼容层做归一化，再交给具体 handler 执行。这样可以保证：

- 老 flow 仍然可以执行
- 新节点编辑器可以输出 DSL 风格数据
- 前后端可以渐进迁移，而不是一次性推翻

---

## 6. 示例：`locator -> count -> if`

### 6.1 DSL 写法

```json
[
  {
    "id": "btns",
    "type": "locator",
    "params": { "selector": "button" },
    "outputType": "locator"
  },
  {
    "id": "btnCount",
    "type": "count",
    "inputs": {
      "target": { "from": "btns" }
    },
    "outputType": "number"
  },
  {
    "id": "hasBtns",
    "type": "if",
    "inputs": {
      "condition": { "from": "btnCount.result" }
    },
    "params": {
      "operator": ">",
      "value": "0",
      "valueType": "number"
    }
  }
]
```

### 6.2 BrowserFlow 写法

```json
{
  "nodes": [
    {
      "id": "node_locator",
      "type": "locator",
      "position": { "x": 120, "y": 120 },
      "data": {
        "label": "Buttons",
        "nodeType": "locator",
        "captureScreenshot": false,
        "params": {
          "selector": "button",
          "selectorType": "css"
        },
        "inputs": {},
        "outputType": "locator",
        "selector": "button",
        "selectorType": "css"
      }
    },
    {
      "id": "node_count",
      "type": "count",
      "position": { "x": 380, "y": 120 },
      "data": {
        "label": "Count Buttons",
        "nodeType": "count",
        "captureScreenshot": false,
        "params": {},
        "inputs": {
          "target": { "from": "node_locator" }
        },
        "outputType": "number"
      }
    },
    {
      "id": "node_if",
      "type": "if",
      "position": { "x": 640, "y": 120 },
      "data": {
        "label": "Has Buttons?",
        "nodeType": "if",
        "captureScreenshot": false,
        "params": {
          "operator": ">",
          "value": "0",
          "valueType": "number",
          "condition": "True"
        },
        "inputs": {
          "condition": { "from": "node_count.result" }
        },
        "operator": ">",
        "value": "0",
        "valueType": "number"
      }
    }
  ],
  "edges": [
    {
      "id": "e_locator_count",
      "source": "node_locator",
      "target": "node_count"
    },
    {
      "id": "e_count_if",
      "source": "node_count",
      "target": "node_if"
    }
  ]
}
```

对应的现成示例见：`examples/dsl-if-count.json`。

---

## 7. 分支节点映射：`if`

`if` 节点在 BrowserFlow 中除了保留 DSL 风格条件配置，还会把分支信息放进边上。

例如：

```json
{
  "id": "e_if_true_map",
  "source": "node_if",
  "sourceHandle": "true",
  "target": "node_map",
  "data": {
    "condition": "true"
  }
}
```

```json
{
  "id": "e_if_false_stop",
  "source": "node_if",
  "sourceHandle": "false",
  "target": "node_stop",
  "data": {
    "condition": "false"
  }
}
```

这里：

- `node.data.inputs.condition` 决定判断值来源
- `node.data.params.operator/value/valueType` 决定比较规则
- `edges[].data.condition` 或 `sourceHandle` 决定真假分支流向

---

## 8. 集合节点映射：`all`、`foreach`、`map`

### `all`

- 输入：`inputs.target`
- 输出：通常通过 `items` 暴露 locator 列表

```json
"inputs": {
  "target": { "from": "node_locator" }
}
```

### `foreach`

```json
"inputs": {
  "items": { "from": "node_all.items" }
},
"params": {
  "itemName": "btn"
}
```

含义：

- 从 `node_all.items` 读取数组
- 每一轮把当前项注册为别名 `btn`
- 后续子链路节点可直接通过 `{ "from": "btn" }` 使用该项

`foreach` 现在支持两个不同的出边语义：

- `sourceHandle = "body"`：循环体入口，每个 item 都会执行这条子链路
- `sourceHandle = "done"`：循环完成后只执行一次的后续链路

也就是说：

- 接在 `body` 上的是“循环内容”
- 接在 `done` 上的是“整个 foreach 执行完之后继续做什么”

兼容性规则：

- 新建流程时，推荐显式使用 `body` / `done`
- 旧流程如果 `foreach` 的边没有 `sourceHandle`，后端仍会把它当作 `body`

示例：

```json
{
  "source": "node_foreach",
  "sourceHandle": "body",
  "target": "node_click"
}
```

```json
{
  "source": "node_foreach",
  "sourceHandle": "done",
  "target": "node_after_loop"
}
```

### `map`

```json
"inputs": {
  "items": { "from": "node_foreach.items" }
},
"params": {
  "itemName": "el",
  "expression": "el => ({ index: el.index, selector: el.selector, visible: true })"
}
```

当前实现中，`map` 更接近“BrowserFlow 内部可执行的表达式映射节点”，不是完整的 Playwright `evaluateAll` 等价物，但足以覆盖常见列表变换场景。

### `set`

`set` 节点用于声明或更新流程级变量。变量存储在运行时上下文中，后续节点可直接通过变量名或 `vars.xxx` 引用。

```json
{
  "type": "set",
  "params": {
    "variableName": "results",
    "operation": "set",
    "valueType": "array",
    "value": "[]"
  }
}
```

在 `foreach` 里追加数据：

```json
{
  "type": "set",
  "params": {
    "variableName": "results",
    "operation": "append"
  },
  "inputs": {
    "value": { "from": "node_text.result" }
  }
}
```

支持的操作：

- `set`：覆盖变量值
- `append`：向数组追加值
- `merge`：合并对象
- `clear`：清空当前变量

引用方式：

- `results`：直接按变量名引用
- `vars.results`：显式从变量存储读取
- `results[0]`：按索引读取数组变量
- `vars.results[1]`：显式按索引读取数组变量

在 `inputs.from` 中，上述写法都可直接使用，也兼容 `${results}`、`${vars.results}` 这类模板形式。

随机模板函数：

- `${random.alnum(length)}`：生成单个字母数字随机串
- `${random.alnum(length, count):varName}`：批量生成并保存到变量
- `${random.alpha(length)}`：生成纯字母随机串
- `${random.numeric(length)}`：生成纯数字随机串
- `${random.hex(length)}`：生成十六进制随机串
- `${random.password(length)}`：生成单个随机密码
- `${random.password(length, count):varName}`：批量生成密码并保存到变量
- `${random.password(length, "!@#$_-")}`：指定特殊字符集合生成密码
- `${random.uuid()}`：生成单个 UUID
- `${random.uuid(count):varName}`：批量生成 UUID 并保存

说明：

- 未传 `count` 时默认生成 `1` 个
- `count = 1` 时返回单值
- `count > 1` 时返回数组，可通过 `${varName[index]}` 读取
- 当前全局模板函数不支持 `numeric` 的 `min/max` 范围写法
- 这类需求请改用 `random` 节点生成，再通过变量引用结果

Random 节点：

- 节点类型：`random`
- 参数：
  - `kind`：`alnum` / `alpha` / `numeric` / `hex` / `password` / `uuid`
  - `length`：随机串长度，`uuid` 时可忽略
  - `count`：生成数量，默认 `1`
  - `min` / `max`：当 `kind = numeric` 时可选，表示整数范围
  - `specialChars`：当 `kind = password` 时可选，表示允许的特殊符号集合
  - `variableName`：可选，保存到变量仓库
- 输出：
  - `result`：单值结果或首个结果
  - `items`：完整随机结果数组
  - `kind` / `length` / `count` / `min` / `max` / `specialChars` / `variableName`

行为说明：

- `kind = numeric` 且未传 `min/max`：按长度生成数字字符串
- `kind = numeric` 且同时传 `min/max`：生成范围内随机整数
- `kind = password`：生成包含特殊字符的密码，特殊字符来源于 `specialChars`

调用建议：

- 生成密码：使用 `random` 节点，设置 `kind = password`，再通过 `${password}` 这类变量引用
- 生成范围整数：使用 `random` 节点，设置 `kind = numeric` + `min/max`，再通过 `${code}` 这类变量引用

推荐场景：

- 需要在多个后续节点里复用同一批随机值
- 需要在执行日志中清晰看到随机值生成步骤
- 需要先生成账号/验证码/ID，再分别写入表单、文件或请求参数

推荐用法：

1. 在 `foreach` 前用 `set` 初始化数组变量
2. 在循环体中用 `append` 收集每轮结果
3. 在循环后的 `done` 链路中通过 `results` 或 `vars.results` 继续使用

完整示例见：`examples/dsl-foreach-if-map.json`。

---

## 9. 前端节点编辑器约定

当前前端编辑器创建节点时，会默认生成：

- `data.label`
- `data.nodeType`
- `data.captureScreenshot`
- `data.params`
- `data.inputs`
- `data.outputType`

并在必要时额外回填 legacy 字段，例如：

- `selector`
- `selectorType`
- `itemName`
- `expression`
- `operator`
- `value`

因此前端保存出来的 flow JSON 是：

- **对后端 DSL 友好**
- **对旧逻辑兼容**
- **对画布渲染友好**

---

## 10. 后端执行器约定

后端并不要求所有节点都已经完全迁移成纯 DSL 格式。

执行时会做三件事：

1. 从 `node.data` 读取配置
2. 通过兼容层归一化 `params / inputs / outputType / legacy 字段`
3. 再把归一化结果交给各个 node handler

这意味着：

- 老 flow 可以继续跑
- 新 DSL 节点可以直接跑
- 同一个项目里允许两种风格并存

---

## 11. 推荐实践

新增节点时，建议优先遵循以下规则：

1. `node.type` 与 `node.data.nodeType` 保持一致
2. 业务参数优先写入 `data.params`
3. 上游依赖优先写入 `data.inputs`
4. 明确声明 `data.outputType`
5. 如需兼容旧节点，再补平铺字段
6. 运行顺序依赖 `edges`，不要只依赖 `inputs`

---

## 12. 总结

当前 BrowserFlow 对 Playwright DSL 的落地方式，可以概括为：

- **DSL 节点定义** → 落到 `node.data.params / inputs / outputType`
- **画布能力** → 落到 `position / label / edges`
- **兼容旧系统** → 保留 legacy 平铺字段
- **执行层统一** → 后端先归一化再分发给 handler

如果你已经有纯 DSL 节点数组，接入 BrowserFlow 时通常只需要补上三类信息：

- `position`
- `data.label`
- `edges`

其余 DSL 核心语义可以直接映射到现有系统。

---

## 13. DSL 节点速查表

下表用于快速查看“DSL 节点类型”在当前 BrowserFlow 中应该如何落到 `node.data`。

| DSL 节点 | 主要输入 `data.inputs` | 主要参数 `data.params` | 典型 `outputType` | 说明 |
|---|---|---|---|---|
| `document` | - | - | `locator` | 页面根 locator |
| `locator` | `target` 可选 | `selector`, `selectorType` | `locator` | 生成 locator；可从 page 或上游 locator 派生 |
| `first` | `target` | - | `locator` | 取第一个元素 |
| `last` | `target` | - | `locator` | 取最后一个元素 |
| `nth` | `target` | `index` | `locator` | 取指定下标 |
| `all` | `target` | - | `locator[]` | 展开 locator 列表，结果通常从 `items` 读取 |
| `count` | `target` | - | `number` | 返回匹配数量 |
| `textContent` | `target` | - | `string` | 读取文本，可空时由后端处理 |
| `innerText` | `target` | - | `string` | 读取 innerText |
| `inputValue` | `target` | - | `string` | 读取输入框值 |
| `getAttribute` | `target` | `name` | `string` | 读取属性值 |
| `isVisible` | `target` | - | `boolean` | 判断可见性 |
| `isEnabled` | `target` | - | `boolean` | 判断是否启用 |
| `isChecked` | `target` | - | `boolean` | 判断是否选中 |
| `click` | `target` | `index` 可选 | `void` | 点击；兼容 legacy selector 写法 |
| `type` | `target` | `text` | `void` | 输入文本 |
| `press` | `target` | `key` | `void` | 按键 |
| `hover` | `target` | - | `void` | 悬停 |
| `check` | `target` | - | `void` | 勾选 |
| `uncheck` | `target` | - | `void` | 取消勾选 |
| `selectOption` | `target` | `value` | `void` | 下拉选择 |
| `waitFor` | `target` | `state`, `timeout` | `void` | 等待 locator 状态 |
| `waitForURL` | - | `url`, `waitUntil`, `timeout` | `void` | 等待 URL |
| `waitForLoadState` | - | `state`, `timeout` | `void` | 等待页面加载状态 |
| `title` | - | - | `string` | 读取页面标题 |
| `url` | - | - | `string` | 读取页面 URL |
| `content` | - | - | `string` | 读取页面 HTML |
| `viewport` | - | - | `object` | 读取视口信息 |
| `foreach` | `items` | `itemName` | `array` | 为每一项建立迭代别名，并驱动子链路 |
| `map` | `items` | `itemName`, `expression` / `fn` | `array` | 列表映射，支持简单 JS 风格表达式 |
| `if` | `condition` | `operator`, `value`, `valueType` | `boolean` / 控制流 | 判断结果主要通过分支边消费 |
| `stop` | - | `stopType`, `errorMessage` | `void` | 主动停止流程 |

### 13.1 locator 家族

最常见写法：

```json
{
  "type": "locator",
  "data": {
    "nodeType": "locator",
    "params": {
      "selector": "button",
      "selectorType": "css"
    },
    "inputs": {},
    "outputType": "locator",
    "selector": "button",
    "selectorType": "css"
  }
}
```

如果要从上游 locator 继续细化，也可以写成：

```json
{
  "inputs": {
    "target": { "from": "node_parent_locator" }
  },
  "params": {
    "selector": ".item"
  }
}
```

### 13.2 查询节点家族

查询节点通常遵循同一模式：

```json
{
  "data": {
    "nodeType": "textContent",
    "params": {},
    "inputs": {
      "target": { "from": "node_locator" }
    },
    "outputType": "string"
  }
}
```

可替换的 `nodeType` 包括：

- `count`
- `textContent`
- `innerText`
- `inputValue`
- `getAttribute`
- `isVisible`
- `isEnabled`
- `isChecked`

### 13.3 动作节点家族

动作节点一般也是 `inputs.target + params` 的组合：

```json
{
  "data": {
    "nodeType": "click",
    "params": {
      "index": 0
    },
    "inputs": {
      "target": { "from": "node_locator" }
    },
    "outputType": "void"
  }
}
```

同类节点包括：

- `click`
- `type`
- `press`
- `hover`
- `check`
- `uncheck`
- `selectOption`

### 13.4 页面级读取节点

页面级节点不依赖 `target`，直接读取当前页面状态：

```json
{
  "data": {
    "nodeType": "title",
    "params": {},
    "inputs": {},
    "outputType": "string"
  }
}
```

同类节点包括：

- `title`
- `url`
- `content`
- `viewport`

### 13.5 控制流节点

#### `if`

```json
{
  "data": {
    "nodeType": "if",
    "params": {
      "operator": ">",
      "value": "0",
      "valueType": "number",
      "condition": "True"
    },
    "inputs": {
      "condition": { "from": "node_count.result" }
    }
  }
}
```

分支走向仍由 `edges` 决定：

```json
{
  "source": "node_if",
  "sourceHandle": "true",
  "target": "node_next_true",
  "data": { "condition": "true" }
}
```

#### `foreach`

```json
{
  "data": {
    "nodeType": "foreach",
    "params": {
      "itemName": "btn"
    },
    "inputs": {
      "items": { "from": "node_all.items" }
    },
    "outputType": "array",
    "itemName": "btn"
  }
}
```

后续子节点可以直接引用：

```json
{
  "inputs": {
    "target": { "from": "btn" }
  }
}
```

#### `map`

```json
{
  "data": {
    "nodeType": "map",
    "params": {
      "itemName": "el",
      "expression": "el => ({ text: el.textContent, index: el.index })"
    },
    "inputs": {
      "items": { "from": "node_all.items" }
    },
    "outputType": "array",
    "itemName": "el",
    "expression": "el => ({ text: el.textContent, index: el.index })"
  }
}
```

---

## 14. 新增 DSL 节点时的落地模板

如果后续继续新增 DSL 节点，推荐直接套用下面的 BrowserFlow 结构模板：

```json
{
  "id": "node_xxx",
  "type": "xxx",
  "position": { "x": 0, "y": 0 },
  "data": {
    "label": "XXX",
    "nodeType": "xxx",
    "captureScreenshot": false,
    "params": {},
    "inputs": {},
    "outputType": "void"
  }
}
```

如果节点需要兼容旧逻辑，再补：

- `selector`
- `selectorType`
- `expression`
- `itemName`
- `operator`
- `value`

等平铺字段即可。