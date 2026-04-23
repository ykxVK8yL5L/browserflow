# 🚨🚨🚨 安全与隐私提醒：请勿在 Flow 中直接填写账号、密码、Token、Cookie 等敏感信息；请优先使用 `{{credential:name}}` 占位符。分享或导出 Flow 前，请再次确认节点配置、执行记录、日志与产出文件中不包含任何敏感数据。 🚨🚨🚨

# browserflow

browserflow

部署过程：
```
cd frontend
pnpm i
pnpm run build
cd ../backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
## Docker运行
```
docker run --name browserflow -d -p 8000:8000 -v $(pwd):/app/backend/data ghcr.io/ykxvk8yl5l/browserflow/browserflow:latest
```

## 文档

- `playwright-dsl.md`：DSL 设计原稿
- `DSL_MAPPING.md`：DSL 与当前 BrowserFlow `{ nodes, edges }` 结构的映射说明

## 执行状态说明

前端当前统一使用以下几种执行状态：

- `idle`：未开始
- `running`：执行中
- `completed`：执行完成
- `failed`：执行失败
- `stopped`：已手动停止

补充说明：

- 后端数据库内部仍可能出现 `cancelled` 状态
- 前端展示层会将 `cancelled` 统一映射为 `stopped`
- 因此在执行面板、历史记录、日志提示中，你看到的会统一是 `Stopped`

这表示：

- 用户点击了 `Stop`
- 或执行在后端被标记为取消
- 但前端不会再单独区分 `cancelled` 与 `stopped` 两套文案

## DSL 最小示例

当前项目已兼容一批 Playwright DSL 风格节点，包括：

- `locator`
- `count`
- `all`
- `foreach`
- `map`
- `if`
- `title`
- `url`
- `content`
- `viewport`

### 示例 1：判断页面是否存在按钮

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

### 示例 2：提取按钮文本列表

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
		"id": "texts",
		"type": "map",
		"inputs": {
			"items": { "from": "btnList.items" }
		},
		"params": {
			"itemName": "el",
			"fn": "el => ({ text: el.hasText, index: el.index })"
		},
		"outputType": "array"
	}
]
```

### 示例 3：读取页面标题和 URL

```json
[
	{
		"id": "pageTitle",
		"type": "title",
		"outputType": "string"
	},
	{
		"id": "pageUrl",
		"type": "url",
		"outputType": "string"
	}
]
```

说明：

- `if` 节点现已支持 `inputs.condition + params.operator + params.value`
- `map` 节点兼容 `expression` 与 `fn`
- `map` 支持箭头函数风格和对象字面量返回
- 页面级读取可直接使用 `title` 与 `url`
- 页面级读取还支持 `content` 与 `viewport`

可直接导入的示例文件：

- `examples/dsl-if-count.json`
- `examples/dsl-map-title-url.json`
- `examples/dsl-foreach-if-map.json`

## 节点通用等待

现在每个节点在“通用信息”里都支持等待和自动截图控制：

- `执行前等待时间 (ms)`
- `执行后等待时间 (ms)`
- `自动截图`
- `截图时机`

用途：

- 想在点击、输入、跳转前先停一下
- 想在节点执行完成后再等一会儿再进入下一个节点
- 减少到处插入单独 `wait` 节点

说明：

- 默认都是 `0`
- 单位是毫秒
- 这是所有节点通用的执行包装逻辑，不区分节点类型
- 执行后等待会在当前节点成功、跳过、停止等非失败结果后生效；失败时不会额外等待
- 截图时机默认是 `执行后截图`
- 目前支持三种截图时机：`执行前截图`、`执行后截图`、`失败时截图`

## DSL 变量与模板语法

当前 DSL 已支持统一的模板变量语法，可在 `params`、`inputs`、以及部分 legacy 平铺字段中使用：

- `${nodeId.result}`：引用节点输出字段
- `${nodeId.items}`：引用节点输出中的列表字段
- `${vars.baseUrl}`：引用变量存储中的值
- `${myVar}`：引用变量存储中的顶层变量
- `${accounts[0]}`：按索引读取数组变量中的值
- `${vars.accounts[1]}`：显式从变量仓库按索引读取数组值

### DSL Inputs 写法

`inputs` 现在同时兼容“裸引用”和“模板字符串”：

- 裸引用：`message`、`vars.message`、`nodeId.result`
- 纯模板：`${message}`、`${nodeId.result}`
- 混合文本：`验证码：${message}`、`prefix-${nodeId.result}-suffix`

推荐规则：

- 需要传递原始对象 / 数组 / locator 时，优先使用裸引用或纯模板，例如 `message`、`${items}`
- 需要把普通文本与变量拼接时，使用模板字符串，例如 `验证码：${code}`

说明：

- `inputs.xxx = { "from": "message" }` 会直接读取变量或节点输出
- `inputs.xxx = { "from": "验证码：${message}" }` 会先进行模板展开，结果为字符串
- 一旦与普通文本混合，最终值会变成字符串

### 随机模板函数

当前模板系统支持“模板函数调用”，可直接在任意支持模板解析的文本参数中使用：

- 通用形式：`${namespace.function(arg1, arg2, ...)}`
- 可选保存变量：在表达式末尾加 `:varName`，例如 `${random.alnum(12, 5):accounts}`

目前内置以下命名空间（后续会持续扩展）：

- `random.*`：随机值生成
- `time.*`：时间相关
- `json.*`：JSON 解析/序列化与取值
- `faker.*`：基于 Faker 的假数据生成

> 说明：旧版的 `random.*` 解析逻辑仍保留以兼容历史流程，但建议统一按“模板函数调用”理解。

#### random.*

- `${random.alnum(length)}`：生成字母+数字随机串
- `${random.alpha(length)}`：生成纯字母随机串
- `${random.numeric(length)}`：生成纯数字随机串
- `${random.hex(length)}`：生成十六进制随机串
- `${random.password(length)}`：生成带特殊字符的随机密码
- `${random.ms_password(length)}`：生成符合微软复杂度要求的随机密码（大写+小写+数字+特殊字符）
- `${random.uuid()}`：生成单个 UUID

#### time.*

- `${time.now()}`：返回当前时间（ISO8601 字符串）
- `${time.now("utc")}`：返回当前 UTC 时间（ISO8601 字符串）
- `${time.epoch_ms()}`：返回当前 UTC epoch 毫秒数（number）
- `${time.format(value, "%Y-%m-%d")}`：格式化时间（value 支持 ISO 字符串或 epoch 毫秒）
- `${time.add_ms(value, delta_ms)}`：时间加/减毫秒（返回 ISO 字符串）

#### json.*

- `${json.parse(text)}`：解析 JSON 字符串
- `${json.dumps(value)}`：序列化为 JSON 字符串（`ensure_ascii=false`）
- `${json.dumps(value, 2)}`：带缩进输出
- `${json.get(obj, "a.b[0]", default)}`：按路径取值，取不到返回 default

#### faker.*

- `${faker.call("email")}`：调用 Faker 方法生成单个值
- `${faker.call("email", 10)}`：生成 10 个值（返回数组）
- `${faker.call("text", 1, "zh_CN", false, 123, {"max_nb_chars": 40})}`：带 locale/seed/kwargs
- `${faker.preset("name")}`：使用内置 preset（等价于 call 对应方法）

> 说明：模板函数版本的 faker 只做“生成值”，不负责把结果写入 vars。
> 如需保存变量，请用表达式末尾的 `:varName`（通用能力），例如 `${faker.call("email"):email}`。

如果不传数量参数，默认生成 `1` 个。

#### 1. 直接生成单个随机值

```json
{
	"id": "fillUsername",
	"type": "fill",
	"inputs": {
		"target": { "from": "usernameInput" },
		"value": "user_${random.alnum(12)}"
	}
}
```

#### 2. 批量生成并保存到变量

随机函数支持第二个参数 `count`，用于一次生成多个值；同时支持 `:varName` 将结果保存到变量仓库：

- `${random.alnum(12, 5):accounts}`
- `${random.numeric(6, 10):codes}`
- `${random.password(12, 3):passwords}`
- `${random.uuid(3):ids}`

`password` 支持以下写法：

- `${random.password(12)}`：生成 1 个长度为 12 的密码
- `${random.password(12, 5)}`：生成 5 个密码
- `${random.password(12, "!@#$_-")}`：生成 1 个密码，并指定特殊字符集合
- `${random.password(12, 5, "!@#$_-"):passwords}`：生成 5 个密码，指定特殊字符集合并保存到变量

`ms_password` 支持以下写法（长度必须 `>= 10`）：

- `${random.ms_password(12)}`：生成 1 个长度为 12 的强密码
- `${random.ms_password(12, 5)}`：生成 5 个强密码
- `${random.ms_password(12, "@#$%!&*")}`：生成 1 个强密码，并指定特殊字符集合
- `${random.ms_password(12, 5, "@#$%!&*"):passwords}`：生成 5 个强密码，指定特殊字符集合并保存到变量

示例：

```json
{
	"id": "prepareAccounts",
	"type": "set",
	"params": {
		"variableName": "accounts",
		"operation": "set",
		"value": "${random.alnum(12, 5):accounts}"
	}
}
```

#### 3. 按索引读取批量随机结果

保存后可在后续节点中直接读取：

- `${accounts[0]}`
- `${accounts[1]}`
- `${vars.accounts[2]}`

例如：

```json
{
	"id": "fillSecondAccount",
	"type": "fill",
	"inputs": {
		"target": { "from": "usernameInput" },
		"value": "${accounts[1]}"
	}
}
```

说明：

- 数量为 `1` 时返回单个值
- 数量大于 `1` 时返回数组
- 如果带 `:varName`，会自动写入变量仓库，后续可反复引用
- `uuid` 不需要长度参数，支持 `${random.uuid()}` 和 `${random.uuid(count):varName}`
- 当前全局模板函数**还不支持** `${random.numeric(min,max)}` 这种范围写法
- 如果要生成范围整数，请使用 `Random` 节点，并在后续通过 `${变量名}` 继续引用

### Random 节点

如果你希望“生成一次，后续多次复用”，推荐直接使用 `Random` 节点，而不是把随机表达式散落在多个参数里。

节点参数：

- `Random Type`：`alnum` / `alpha` / `numeric` / `hex` / `password` / `ms_password` / `uuid`
- `Length`：随机串长度；`uuid` 类型下可忽略
- `Count`：生成数量，默认 `1`
- `Min Range` / `Max Range`：当 `Random Type = numeric` 时，可按整数范围生成随机数
- `Special Chars`：当 `Random Type = password` 时，指定允许使用的特殊符号集合
- `Save To Variable`：可选，填写后会自动保存到变量仓库

补充说明：

- `numeric` 未填写范围时，保持原有行为：按 `Length` 生成纯数字字符串
- `numeric` 同时填写 `Min Range` 和 `Max Range` 时，生成该范围内的随机整数
- `password` 会至少包含 `1` 个特殊字符，特殊字符从 `Special Chars` 中挑选
- `ms_password` 会至少包含：2 大写 + 4 小写 + 3 数字 + 1 特殊字符（其余位从字母+数字补齐）

节点输出：

- `result`：当 `count = 1` 时为单个值，否则为首个值
- `items`：完整结果数组
- `kind` / `length` / `count` / `min` / `max` / `specialChars` / `variableName`

使用示例：

1. 生成单个用户名并保存到变量 `username`
2. 后续输入框节点直接使用 `${username}`
3. 如果一次生成多个账号，可填写 `Save To Variable = accounts`，然后在后续节点中使用 `${accounts[0]}`、`${accounts[1]}`

密码示例：

- `Random Type = password`
- `Length = 12`
- `Special Chars = !@#$_-`

如果需要在后续节点里使用，建议同时填写：

### Transform 节点（通用数据转换）

当你希望在流程中“显式地”做一次转换（而不是写在模板字符串里），推荐使用 `Transform` 节点。

它会对输入值应用一个内置模板函数（与 `${namespace.function(...)}` 同源），避免为 `time/json/string` 等每个小能力都新增专用节点。

参数：

- `Function`：选择要调用的函数，例如 `json.parse` / `json.dumps` / `time.now` / `regex.match` 等
- `Args (after value)`：可选参数列表（在输入 value 之后依次传入）
- `Save To Variable`：可选，保存到变量仓库

Inputs：

- `value`：要转换的输入值（可引用上游输出、变量，也可写模板字符串）

输出：

- `result`：转换后的值

示例：

1) 把节点输出的 JSON 文本解析成对象：

- `Function = json.parse`
- `value = ${someNode.result}`

2) 把对象序列化成 JSON：

- `Function = json.dumps`
- `Args = 2`（可选缩进）

3) 生成时间戳并保存：

- `Function = time.epoch_ms`
- `Save To Variable = ts`

### Transform 支持的 regex 函数

`Transform` 节点现已支持以下正则函数：

- `regex.match`
- `regex.findall`
- `regex.findall_detail`
- `regex.replace`
- `regex.split`
- `regex.test`

常见用法：

#### 1. 提取第一个匹配项

- `value = message`
- `Function = regex.match`
- `Args = ["\\d+"]`
- `Save To Variable = yanzhengma`

如果原文是 `您的验证码是 123456`，则 `yanzhengma` 大致为：

```json
{
	"match": "123456",
	"groups": [],
	"groupdict": {},
	"start": 7,
	"end": 13
}
```

后续引用验证码正文请使用：`${yanzhengma.match}`。

#### 2. 提取全部匹配项

- `value = message`
- `Function = regex.findall`
- `Args = ["\\d+"]`

返回值通常为数组，例如：`["123456", "7890"]`。

#### 3. 替换文本

- `value = message`
- `Function = regex.replace`
- `Args = ["\\d+", "******"]`

#### 4. 判断是否命中

- `value = message`
- `Function = regex.test`
- `Args = ["\\d+"]`

返回值为布尔值。

#### 5. 在 DSL Inputs 中直接混合文本与变量

例如 `Transform.value` 也可以直接写成：

- `验证码原文：${message}`
- `prefix-${someNode.result}`

但请注意：如果函数期望处理的是原始对象或数组，建议仍然传裸引用，不要和文本混合。

### Faker 节点（假数据生成）

`Faker` 节点封装了 Python 库 [joke2k/faker](https://github.com/joke2k/faker)，用于生成姓名、邮箱、手机号、地址等“看起来真实”的测试数据。

设计原则：

- **封闭调用**：每个节点只允许调用一个 Faker 方法，避免任意代码执行。
- **可扩展**：提供常用 `Preset`，也支持高级用户直接填写 `Method Name`。
- **可控**：支持 `locale` / `seed` / `unique` / `count`。

节点参数：

- `Preset`：常用模板（例如 `name` / `email` / `address` 等）；选择后会覆盖 `Method Name`
- `Method Name`：Faker 方法名（例如 `name`, `email`, `phone_number`）
	- 仅允许字母/数字/下划线，并禁止以下划线开头（防止访问私有属性）
- `Locale (optional)`：例如 `zh_CN`、`en_US`；留空使用 Faker 默认
- `Count`：生成数量（最大 1000）
- `Unique`：是否启用 `faker.unique`（同一 Faker 实例内尽量不重复；过多可能抛出 unique exhausted）
- `Seed (optional)`：整数；设置后同一节点在同版本 Faker 下可复现
- `Kwargs (object, optional)`：可选参数（JSON 对象字符串），会作为 `**kwargs` 传给 Faker 方法
- `Save To Variable`：可选，保存到变量仓库

节点输出：

- `result`：当 `count = 1` 时为单个值；当 `count > 1` 时为第一个值
- `items`：完整生成结果数组

示例：

- 生成中文姓名（指定 locale）：
	- `Preset = name`
	- `Locale = zh_CN`

- 生成 10 个邮箱并保存到变量：
	- `Preset = email`
	- `Count = 10`
	- `Save To Variable = emails`
	- 后续可用 `${emails[0]}` / `${emails[1]}`

- 使用自定义方法并传 kwargs（示例：生成指定长度文本）：
	- `Preset = (Custom Method)`
	- `Method Name = text`
	- `Kwargs = {"max_nb_chars": 40}`

- `Save To Variable = password`

后续即可直接引用：

- `${password}`

范围数值示例：

- `Random Type = numeric`
- `Min Range = 100000`
- `Max Range = 999999`
- 可用于生成 6 位短信验证码或随机编号

如果需要在后续节点里使用，建议同时填写：

- `Save To Variable = code`

后续即可直接引用：

- `${code}`

### 推荐规则

#### 1. 纯变量输入

如果输入本身就是另一个节点的结果，推荐直接写模板：

```json
{
	"id": "fillKeyword",
	"type": "fill",
	"inputs": {
		"target": { "from": "searchInput" },
		"value": "${keywordNode.result}"
	}
}
```

当整个值就是一个模板时，会返回原始类型，而不是强制转成字符串。例如：

- `${countNode.result}` -> `number`
- `${flagNode.result}` -> `boolean`
- `${listNode.items}` -> `array`

当然，`{ "from": "nodeId.result" }` 这种旧写法仍然兼容。

#### 2. 字符串拼接

如果要把变量和字符串组合，直接写到模板字符串里：

```json
{
	"id": "gotoDetail",
	"type": "navigate",
	"params": {
		"url": "https://example.com${hrefNode.result}"
	}
}
```

如果 `hrefNode.result` 是 `/detail/123`，最终会得到：

```text
https://example.com/detail/123
```

#### 3. 变量仓库引用

如果你前面已经把值存进变量仓库，也可以直接引用：

```json
{
	"id": "gotoDetail",
	"type": "navigate",
	"params": {
		"url": "${vars.baseUrl}${hrefNode.result}"
	}
}
```

### 常见用法

#### 用 `href` 拼接完整 URL 后跳转

```json
[
	{
		"id": "link",
		"type": "locator",
		"params": {
			"selector": "a.item-link"
		}
	},
	{
		"id": "hrefNode",
		"type": "getAttribute",
		"inputs": {
			"target": { "from": "link" }
		},
		"params": {
			"attribute": "href"
		}
	},
	{
		"id": "gotoDetail",
		"type": "navigate",
		"params": {
			"url": "https://example.com${hrefNode.result}"
		}
	}
]
```

#### 在 inputs 中统一使用模板语法

```json
{
	"id": "fillSearch",
	"type": "fill",
	"inputs": {
		"target": "${searchInput}",
		"value": "关键词：${keywordNode.result}"
	}
}
```

说明：

- `inputs.target` 如果是纯模板，例如 `${searchInput}`，会解析为原始运行时值
- `inputs.value` 如果包含前后缀文本，会解析为字符串
- 未解析到的模板会保留原样，便于排查问题

## Foreach 中的 break / continue

当前已支持两个循环控制节点：

- `break`：结束当前 `foreach`，然后走 `foreach` 的 `done` 分支
- `continue`：跳过当前这一轮剩余节点，直接进入下一轮

### 使用约束

- 这两个节点只在 `foreach` 的 body 内生效
- 如果放在循环外，会显示为 `skipped`
- 这两个节点本身不需要配置参数

### break 示例

```json
{
	"id": "breakLoop",
	"type": "break"
}
```

### continue 示例

```json
{
	"id": "skipCurrent",
	"type": "continue"
}
```

## Thanks to 

- [loveable](https://loveable.dev/)
- [codex](https://github.com/openai/codex)
- [nvidia](https://build.nvidia.com/)
