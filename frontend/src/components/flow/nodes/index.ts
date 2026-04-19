/**
 * Node Registry — auto-collects all node configs from the nodes/ folder.
 * To add a new node type, just create a new file in nodes/ and import it here.
 */
import NavigateNode from "./NavigateNode";
import LocatorNode from "./LocatorNode";
import CountNode from "./CountNode";
import AllNode from "./AllNode";
import FirstNode from "./FirstNode";
import LastNode from "./LastNode";
import NthNode from "./NthNode";
import ForeachNode from "./ForeachNode";
import WhileNode from "./WhileNode";
import ForNode from "./ForNode";
import MapNode from "./MapNode";
import TextContentNode from "./TextContentNode";
import InnerTextNode from "./InnerTextNode";
import InputValueNode from "./InputValueNode";
import GetAttributeNode from "./GetAttributeNode";
import IsVisibleNode from "./IsVisibleNode";
import IsEnabledNode from "./IsEnabledNode";
import IsCheckedNode from "./IsCheckedNode";
import ClickNode from "./ClickNode";
import MouseNode from "./MouseNode";
import OcrCaptchaNode from "./OcrCaptchaNode";
import SliderCaptchaNode from "./SliderCaptchaNode";
import TypeNode from "./TypeNode";
import PressNode from "./PressNode";
import HoverNode from "./HoverNode";
import CheckNode from "./CheckNode";
import UncheckNode from "./UncheckNode";
import SelectOptionNode from "./SelectOptionNode";
import WaitNode from "./WaitNode";
import WaitForNode from "./WaitForNode";
import WaitForUrlNode from "./WaitForUrlNode";
import WaitForLoadStateNode from "./WaitForLoadStateNode";
import ScreenshotNode from "./ScreenshotNode";
import ScrollNode from "./ScrollNode";
import ScriptNode from "./ScriptNode";
import { type NodeTypeConfig } from "../nodeTypes";
import CookieNode from "./CookieNode";
import LocalStorageNode from "./LocalStorageNode";
import IfNode from "./IfNode";
import ExtractNode from "./ExtractNode";
import CheckExistenceNode from "./CheckExistenceNode";
import BreakNode from "./BreakNode";
import ContinueNode from "./ContinueNode";
import StopNode from "./StopNode";
import SetNode from "./SetNode";
import RandomNode from "./RandomNode";
import FakerNode from "./FakerNode";
import TransformNode from "./TransformNode";
import DocumentNode from "./DocumentNode";
import TitleNode from "./TitleNode";
import UrlNode from "./UrlNode";
import ContentNode from "./ContentNode";
import ViewportNode from "./ViewportNode";
import HttpRequestNode from "./HttpRequestNode";
import FileNode from "./FileNode";
import NewPageNode from "./NewPageNode";
import SwitchPageNode from "./SwitchPageNode";
import ClosePageNode from "./ClosePageNode";
import CurrentPageNode from "./CurrentPageNode";

export const nodeRegistry: NodeTypeConfig[] = [
  NavigateNode,
  LocatorNode,
  CountNode,
  AllNode,
  FirstNode,
  LastNode,
  NthNode,
  ForeachNode,
  WhileNode,
  ForNode,
  MapNode,
  TextContentNode,
  InnerTextNode,
  InputValueNode,
  GetAttributeNode,
  IsVisibleNode,
  IsEnabledNode,
  IsCheckedNode,
  ClickNode,
  MouseNode,
  OcrCaptchaNode,
  SliderCaptchaNode,
  HoverNode,
  CheckNode,
  UncheckNode,
  CookieNode,
  LocalStorageNode,
  IfNode,
  ExtractNode,
  CheckExistenceNode,
  BreakNode,
  ContinueNode,
  StopNode,
  SetNode,
  RandomNode,
  FakerNode,
  TransformNode,
  DocumentNode,
  TitleNode,
  UrlNode,
  ContentNode,
  ViewportNode,
  HttpRequestNode,
  FileNode,
  NewPageNode,
  SwitchPageNode,
  ClosePageNode,
  CurrentPageNode,
  TypeNode,
  PressNode,
  SelectOptionNode,
  WaitNode,
  WaitForNode,
  WaitForUrlNode,
  WaitForLoadStateNode,
  ScreenshotNode,
  ScrollNode,
  ScriptNode,
];
