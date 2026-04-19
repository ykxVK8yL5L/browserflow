import { FileText } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const OcrCaptchaNode: NodeTypeConfig = {
  type: "ocrCaptcha",
  label: "OCR Captcha",
  icon: FileText,
  color: "node-ocrCaptcha",
  description: "Use ddddocr to recognize text in captcha images",
  outputType: "object",
  fields: [
    {
      key: "imageSelector",
      label: "Image Selector",
      type: "text",
      placeholder: "img.captcha-image",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "imageBase64",
      label: "Image Base64",
      type: "text",
      placeholder: "data:image/png;base64,...",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "beta",
      label: "Use Beta Model",
      type: "select",
      options: [
        { label: "否", value: "false" },
        { label: "是", value: "true" },
      ],
      defaultValue: "false",
      valueSource: "params",
    },
    {
      key: "pngFix",
      label: "PNG Fix",
      type: "select",
      options: [
        { label: "否", value: "false" },
        { label: "是", value: "true" },
      ],
      defaultValue: "false",
      valueSource: "params",
    },
    {
      key: "probability",
      label: "Return Probability",
      type: "select",
      options: [
        { label: "否", value: "false" },
        { label: "是", value: "true" },
      ],
      defaultValue: "false",
      valueSource: "params",
    },
    {
      key: "rangeMode",
      label: "Charset Range",
      type: "select",
      options: [
        { label: "不限制", value: "none" },
        { label: "数字", value: "digits" },
        { label: "小写字母", value: "lower" },
        { label: "大写字母", value: "upper" },
        { label: "字母", value: "letters" },
        { label: "小写+数字", value: "lower_digits" },
        { label: "大写+数字", value: "upper_digits" },
        { label: "字母数字", value: "alnum" },
        { label: "特殊字符库", value: "special" },
        { label: "自定义", value: "custom" },
      ],
      defaultValue: "none",
      valueSource: "params",
    },
    {
      key: "customCharset",
      label: "Custom Charset",
      type: "text",
      placeholder: "0123456789ABCDEF",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "colors",
      label: "Color Filter",
      type: "text",
      placeholder: "red,blue",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "customColorRanges",
      label: "Custom Color Ranges JSON",
      type: "text",
      placeholder: '{"light_blue":[[90,30,30],[110,255,255]]}',
      defaultValue: "",
      valueSource: "params",
    },
  ],
  subtitle: "ocr {rangeMode}",
};

export default OcrCaptchaNode;