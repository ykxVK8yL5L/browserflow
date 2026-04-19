# 添加新节点类型指南

本文档介绍如何在 BrowserFlow 中添加新的节点类型。

## 概述

添加新节点需要修改两个部分：
1. **前端**：定义节点配置（UI、字段、图标等）
2. **后端**：实现节点的执行逻辑

---

## 前端部分

### 1. 创建节点配置文件

在 `/frontend/src/components/flow/nodes/` 目录下创建新的 TypeScript 文件。

**文件命名规范**：`{NodeType}Node.ts`（PascalCase）

**示例**：创建一个 "Extract" 节点用于提取页面数据

```typescript
// /frontend/src/components/flow/nodes/ExtractNode.ts
import { FileText } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const ExtractNode: NodeTypeConfig = {
  type: "extract",           // 唯一标识符（后端需要匹配）
  label: "Extract",          // 显示名称
  icon: FileText,            // Lucide 图标
  color: "node-extract",     // CSS 颜色类名
  description: "Extract data from page",  // 描述
  fields: [
    ...selectorFields,       // 复用选择器字段
    {
      key: "attribute",
      label: "Attribute",
      type: "text",
      placeholder: "textContent",
      defaultValue: "textContent",
    },
    {
      key: "variableName",
      label: "Variable Name",
      type: "text",
      placeholder: "result",
      defaultValue: "result",
    },
  ],
  subtitle: "{selector} → {variableName}",  // 节点副标题模板
};

export default ExtractNode;
```

### 2. 节点配置结构说明

```typescript
interface NodeTypeConfig {
  type: string;        // 节点类型标识符（必须与后端匹配）
  label: string;       // 节点显示名称
  icon: LucideIcon;    // Lucide 图标组件
  color?: string;      // CSS 类名，用于节点颜色（可选，默认使用 "node-default"）
  description: string; // 节点描述
  fields: NodeField[]; // 输入字段配置
  subtitle?: string;   // 副标题模板，支持 {fieldKey} 插值
}
```

### 3. 字段类型

```typescript
interface NodeField {
  key: string;          // 字段键名（后端通过此键获取值）
  label: string;        // 字段显示名称
  type: "text" | "number" | "select";  // 字段类型
  placeholder?: string; // 输入框占位符
  options?: {           // select 类型的选项
    label: string;
    value: string;
  }[];
  defaultValue?: string | number;  // 默认值
}
```

### 4. 注册节点

在 `/frontend/src/components/flow/nodes/index.ts` 中导入并注册新节点：

```typescript
// 1. 添加导入
import ExtractNode from "./ExtractNode";

// 2. 添加到 nodeRegistry 数组
export const nodeRegistry: NodeTypeConfig[] = [
  NavigateNode,
  ClickNode,
  TypeNode,
  WaitNode,
  ScreenshotNode,
  ScrollNode,
  ExtractNode,  // <-- 新增
];
```

### 5. 可复用字段

项目提供了可复用的字段配置，位于 `nodes/shared/` 目录：

- `selectorFields`：选择器相关字段（selectorType, selector）

```typescript
import { selectorFields } from "./shared/selectorFields";

// 使用展开运算符复用
fields: [
  ...selectorFields,
  // 其他自定义字段
]
```

---

## 后端部分

### 1. 添加执行逻辑

在 `/backend/core/executor.py` 的 `execute_node()` 方法中添加新节点类型的处理逻辑。

找到 `execute_node()` 方法中的条件判断部分，添加新的 `elif` 分支：

```python
# /backend/core/executor.py
# 在 execute_node() 方法中

async def execute_node(self, node: Dict[str, Any]) -> NodeResult:
    # ... 现有代码 ...
    
    node_type = data.get("nodeType")
    result = NodeResult(node_id=node_id, node_type=node_type, status="running")
    
    try:
        if node_type == "navigate":
            # ... 现有代码 ...
        
        elif node_type == "click":
            # ... 现有代码 ...
        
        # 添加新节点类型
        elif node_type == "extract":
            selector = data.get("selector")
            attribute = data.get("attribute", "textContent")
            variable_name = data.get("variableName", "result")
            
            if selector:
                # 使用 Playwright API 提取数据
                element = await page.query_selector(selector)
                if element:
                    if attribute == "textContent":
                        value = await element.text_content()
                    elif attribute == "innerHTML":
                        value = await element.inner_html()
                    elif attribute == "value":
                        value = await element.get_attribute("value")
                    else:
                        value = await element.get_attribute(attribute)
                    
                    # 存储到变量
                    self.variables[variable_name] = value
                    result.message = f"Extracted to {variable_name}"
                    result.data = {variable_name: value}
                else:
                    result.status = "failed"
                    result.error = f"Element not found: {selector}"
            else:
                result.status = "skipped"
                result.message = "No selector provided"
        
        elif node_type == "hover":
            selector = data.get("selector")
            if selector:
                await page.hover(selector)
                result.message = f"Hovered {selector}"
            else:
                result.status = "skipped"
                result.message = "No selector provided"
        
        else:
            result.status = "failed"
            result.error = f"Unknown node type: {node_type}"
    
    except Exception as e:
        result.status = "failed"
        result.error = str(e)
    
    return result
```

### 2. 数据获取方式

后端通过 `data.get()` 获取前端配置的字段值：

```python
# data 是节点数据对象
# key 对应前端 NodeField 的 key

value = data.get("key")           # 获取值
value = data.get("key", default)  # 带默认值
```

### 3. 常用 Playwright API

| 操作 | API |
|------|-----|
| 导航 | `await page.goto(url)` |
| 点击 | `await page.click(selector)` |
| 填充 | `await page.fill(selector, text)` |
| 等待元素 | `await page.wait_for_selector(selector)` |
| 截图 | `await page.screenshot(path=path)` |
| 执行脚本 | `await page.evaluate(script)` |
| 查询元素 | `await page.query_selector(selector)` |
| 获取文本 | `await element.text_content()` |
| 获取属性 | `await element.get_attribute(name)` |

---

## 完整示例：添加 "Hover" 节点

### 前端

```typescript
// /frontend/src/components/flow/nodes/HoverNode.ts
import { MousePointerClick } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const HoverNode: NodeTypeConfig = {
  type: "hover",
  label: "Hover",
  icon: MousePointerClick,
  // color 字段可选，不指定时使用默认颜色
  description: "Hover over an element",
  fields: [
    ...selectorFields,
  ],
  subtitle: "{selector}",
};

export default HoverNode;
```

注册：
```typescript
// /frontend/src/components/flow/nodes/index.ts
import HoverNode from "./HoverNode";

export const nodeRegistry: NodeTypeConfig[] = [
  // ... 现有节点
  HoverNode,
];
```

### 后端

```python
# /backend/core/executor.py
# 在 execute_node() 方法中添加

elif node_type == "hover":
    selector = data.get("selector")
    if selector:
        await page.hover(selector)
        result.message = f"Hovered {selector}"
    else:
        result.status = "skipped"
        result.message = "No selector provided"
```

---

## 文件清单

| 位置 | 文件 | 操作 |
|------|------|------|
| 前端 | `/frontend/src/components/flow/nodes/{Name}Node.ts` | 新建 |
| 前端 | `/frontend/src/components/flow/nodes/index.ts` | 添加导入和注册 |
| 后端 | `/backend/core/executor.py` | 添加执行逻辑 |

---

## 注意事项

1. **类型标识符一致性**：前端 `type` 字段必须与后端 `node_type` 判断值完全一致
2. **字段键名一致性**：前端 `NodeField.key` 必须与后端 `data.get()` 的键名一致
3. **错误处理**：后端应处理缺失参数的情况，设置 `result.status = "skipped"` 或 `"failed"`
4. **结果数据**：可通过 `result.data` 返回额外数据给前端
5. **图标选择**：使用 [Lucide Icons](https://lucide.dev/icons/) 中的图标
