import { useState } from "react";
import { type Node } from "@xyflow/react";
import { NODE_TYPES_CONFIG, type NodeField } from "./nodeTypes";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface NodeEditorProps {
  node: Node | null;
  open: boolean;
  onSave: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  readOnly?: boolean;
}

const inputClass =
  "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

const labelClass = "text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider";

const NodeEditor = ({ node, open, onSave, onClose, readOnly = false }: NodeEditorProps) => {
  if (!node) return null;
  const nodeData = node.data as Record<string, unknown>;
  const nodeParams = ((nodeData.params as Record<string, unknown> | undefined) ?? {});
  const nodeInputs = ((nodeData.inputs as Record<string, unknown> | undefined) ?? {});
  const nodeType = (nodeData.nodeType as string) || "navigate";
  const config = NODE_TYPES_CONFIG.find((n) => n.type === nodeType);

  const [label, setLabel] = useState((nodeData.label as string) || config?.label || "");
  const [description, setDescription] = useState((nodeData.description as string) || "");
  const [disabled, setDisabled] = useState(Boolean(nodeData.disabled));
  const [captureScreenshot, setCaptureScreenshot] = useState(Boolean(nodeData.captureScreenshot));
  const [screenshotTiming, setScreenshotTiming] = useState(String(nodeData.screenshotTiming ?? "after"));
  const [waitBeforeMs, setWaitBeforeMs] = useState(Number(nodeData.waitBeforeMs ?? 0));
  const [waitAfterMs, setWaitAfterMs] = useState(Number(nodeData.waitAfterMs ?? 0));
  const [stopOnFailure, setStopOnFailure] = useState(nodeData.stopOnFailure !== false); // 默认为 true
  const [fieldValues, setFieldValues] = useState<Record<string, any>>(() => {
    const vals: Record<string, any> = {};
    config?.fields.forEach((f) => {
      const existing = nodeParams[f.key] ?? nodeData[f.key];
      if (f.type === "list") {
        vals[f.key] = Array.isArray(existing) ? existing : [];
      } else {
        vals[f.key] = existing !== undefined ? existing : (f.defaultValue ?? "");
      }
    });
    return vals;
  });
  const [inputRefs, setInputRefs] = useState<Record<string, string>>(() => {
    const vals: Record<string, string> = {};
    config?.inputDefs?.forEach((inputDef) => {
      const existing = nodeInputs[inputDef.key];
      if (existing && typeof existing === "object" && "from" in (existing as Record<string, unknown>)) {
        vals[inputDef.key] = String((existing as Record<string, unknown>).from ?? "");
      } else {
        vals[inputDef.key] = "";
      }
    });
    return vals;
  });

  if (!config) return null;
  const Icon = config.icon;

  const updateField = (key: string, value: any) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const isFieldVisible = (field: NodeField) => {
    if (!field.visibleWhen) return true;

    return Object.entries(field.visibleWhen).every(([dependencyKey, expectedValue]) => {
      return fieldValues[dependencyKey] === expectedValue;
    });
  };

  const handleSave = () => {
    if (readOnly) {
      onClose();
      return;
    }
    const params: Record<string, unknown> = { ...(nodeParams ?? {}) };
    const inputs: Record<string, unknown> = {};
    const updated: Record<string, unknown> = {
      ...nodeData,
      label,
      description,
      disabled,
      captureScreenshot,
      screenshotTiming,
      waitBeforeMs,
      waitAfterMs,
      stopOnFailure,
      params,
      inputs,
      outputType: config.outputType ?? nodeData.outputType,
    };
    config.fields.forEach((f) => {
      updated[f.key] = fieldValues[f.key];
      params[f.key] = fieldValues[f.key];
    });
    config.inputDefs?.forEach((inputDef) => {
      const refValue = inputRefs[inputDef.key]?.trim();
      if (refValue) {
        inputs[inputDef.key] = { from: refValue };
      }
    });
    onSave(node.id, updated);
    onClose();
  };

  const renderField = (field: NodeField) => {
    const value = fieldValues[field.key] ?? "";

    if (field.type === "list" && field.listSchema) {
      const list = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-3">
          {list.map((item, index) => (
            <div key={index} className="flex flex-col gap-2 p-3 rounded-md bg-secondary/50 border border-border relative">
              <button
                onClick={() => {
                  const newList = [...list];
                  newList.splice(index, 1);
                  updateField(field.key, newList);
                }}
                className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-destructive transition-colors"
                disabled={readOnly}
              >
                <Trash2 size={14} />
              </button>
              <div className="grid grid-cols-1 gap-3">
                {field.listSchema.map((subField) => (
                  <div key={subField.key} className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono font-medium text-muted-foreground uppercase">{subField.label}</label>
                    <input
                      className={inputClass}
                      type={subField.type === "number" ? "number" : "text"}
                      value={item[subField.key] ?? ""}
                      onChange={(e) => {
                        const newList = [...list];
                        newList[index] = { ...item, [subField.key]: subField.type === "number" ? Number(e.target.value) : e.target.value };
                        updateField(field.key, newList);
                      }}
                      placeholder={subField.placeholder}
                      readOnly={readOnly}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!readOnly && (
            <button
              onClick={() => {
                const newItem = {};
                field.listSchema.forEach((sf) => {
                  newItem[sf.key] = sf.defaultValue ?? "";
                });
                updateField(field.key, [...list, newItem]);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:border-primary transition-all w-full justify-center"
            >
              <Plus size={14} />
              Add Item
            </button>
          )}
        </div>
      );
    }

    if (field.type === "select" && field.options) {
      return (
        <select
          className={inputClass}
          value={String(value)}
          onChange={(e) => updateField(field.key, e.target.value)}
          disabled={readOnly}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }

    if (field.type === "checkbox") {
      return (
        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <span className="text-sm font-mono text-foreground">
            {field.placeholder || "启用"}
          </span>
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => updateField(field.key, checked)}
            disabled={readOnly}
          />
        </label>
      );
    }

    return (
      <input
        className={inputClass}
        type={field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) =>
          updateField(field.key, field.type === "number" ? Number(e.target.value) : e.target.value)
        }
        placeholder={field.placeholder}
        readOnly={readOnly}
      />
    );
  };

  const renderInputRefField = (key: string, label: string, description?: string) => {
    return (
      <div key={key} className="flex flex-col gap-1.5">
        <label className={labelClass}>{label}</label>
        <input
          className={inputClass}
          type="text"
          value={inputRefs[key] ?? ""}
          onChange={(e) => setInputRefs((prev) => ({ ...prev, [key]: e.target.value }))}
          placeholder="例如: message / ${message} / 文本-${message} / otherNode.result"
          readOnly={readOnly}
        />
        <p className="text-xs font-mono text-muted-foreground">
          {description ? `${description}；` : ""}支持直接引用、`${"${变量}"}` 和普通文本混合。
        </p>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="z-[200] w-[92vw] max-w-[560px] border-border bg-card p-0 shadow-2xl">
        <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-xl">
          <DialogHeader className="border-b border-border px-5 py-4">
            <div className="flex items-center justify-between pr-8">
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon size={18} className="text-primary" />
                <DialogTitle className="font-mono text-sm font-bold text-foreground">
                  {readOnly ? "查看" : "编辑"}{config.label}节点
                </DialogTitle>
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground">{node.id}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(node.id);
                      toast.success("ID copied");
                    }}
                    className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy Node ID"
                  >
                    <Copy size={10} />
                  </button>
                </div>
              </div>
            </div>
          </DialogHeader>

          <Tabs defaultValue="config" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-5 mt-4 grid shrink-0 grid-cols-2">
              <TabsTrigger value="config" className="font-mono text-xs">节点配置</TabsTrigger>
              <TabsTrigger value="general" className="font-mono text-xs">通用信息</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="m-0 flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="flex items-center justify-between">
                <label className={labelClass}>启用状态</label>
                <Switch checked={!disabled} onCheckedChange={(checked) => setDisabled(!checked)} disabled={readOnly} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <label className={labelClass}>失败时停止</label>
                  <p className="text-xs font-mono text-muted-foreground">
                    节点执行失败时是否停止整个流程
                  </p>
                </div>
                <Switch checked={stopOnFailure} onCheckedChange={setStopOnFailure} disabled={readOnly} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <label className={labelClass}>自动截图</label>
                  <p className="text-xs font-mono text-muted-foreground">
                    自动保存当前页面截图，可在执行历史中查看
                  </p>
                </div>
                <Switch checked={captureScreenshot} onCheckedChange={setCaptureScreenshot} disabled={readOnly} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>截图时机</label>
                <select
                  className={inputClass}
                  value={screenshotTiming}
                  onChange={(e) => setScreenshotTiming(e.target.value)}
                  disabled={readOnly || !captureScreenshot}
                >
                  <option value="after">执行后截图</option>
                  <option value="before">执行前截图</option>
                  <option value="failure">失败时截图</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>节点名称</label>
                <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="请输入节点名称" readOnly={readOnly} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>节点描述</label>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="请输入节点描述"
                  readOnly={readOnly}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>执行前等待时间 (ms)</label>
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    step={100}
                    value={waitBeforeMs}
                    onChange={(e) => setWaitBeforeMs(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    readOnly={readOnly}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>执行后等待时间 (ms)</label>
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    step={100}
                    value={waitAfterMs}
                    onChange={(e) => setWaitAfterMs(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    readOnly={readOnly}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="config" className="m-0 flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <div className="rounded-md border border-border bg-secondary/20 p-3">
                <p className="text-xs font-mono font-medium text-foreground">节点说明</p>
                <p className="mt-1 text-xs font-mono text-muted-foreground">{config.description}</p>
              </div>

              {nodeType === "file" && String(fieldValues.action ?? "read") === "read" ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-xs font-mono font-medium text-amber-300">敏感文件读取说明</p>
                  <p className="mt-1 text-xs font-mono text-amber-100/80">
                    开启“敏感内容模式”后，文件正文不会出现在执行日志和节点结果中；后续节点仍可继续使用相同引用，例如
                    <span className="mx-1 rounded bg-background/60 px-1 py-0.5 text-[11px]">${"${read_file.content}"}</span>
                    。开启“按 JSON 解析”后，如果文件内容是合法 JSON，还可以使用
                    <span className="mx-1 rounded bg-background/60 px-1 py-0.5 text-[11px]">${"${read_file.content.key}"}</span>
                    直接访问字段。
                  </p>
                </div>
              ) : null}

              {config.inputDefs && config.inputDefs.length > 0 ? (
                <div className="space-y-4 rounded-md border border-border bg-secondary/20 p-3">
                  <div>
                    <p className="text-xs font-mono font-medium text-foreground">DSL Inputs</p>
                    <p className="text-xs font-mono text-muted-foreground">使用节点输出引用，例如 `prevNode.result`</p>
                  </div>
                  {config.inputDefs.map((inputDef) => renderInputRefField(inputDef.key, inputDef.label, inputDef.description))}
                </div>
              ) : null}

              {config.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground font-mono">该节点没有可配置项。</p>
              ) : (
                config.fields.filter(isFieldVisible).map((field) => (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <label className={labelClass}>{field.label}</label>
                    {renderField(field)}
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background/40 px-5 py-4">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-mono text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">关闭</button>
            {!readOnly && (
              <button onClick={handleSave} className="rounded-md bg-primary px-4 py-2 text-sm font-mono text-primary-foreground transition-opacity hover:opacity-90">保存</button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NodeEditor;
