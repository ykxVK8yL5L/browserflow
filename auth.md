# 统一认证与访问控制系统设计（最终版 v4）

## 一、系统目标

构建一个可扩展、安全、可控的统一认证体系，支持：


-   整个系统共有用户名密码、邮箱，passkey/opt，恢复码四种认证方式，其中用户名密码，otp，恢复码在创建账号后为必须完善，此后任何重要安全修改，必须满足两种不同的认证方式
-   用户名密码登录（主方式）
-   Passkey 登录（可选）
-   OTP（二次验证，强制）
-   恢复码（账户恢复,强制，兜底使用）
-   JWT Token 认证 (过期时间支持自定义)
-   Session 会话控制（支持踢人下线）
-   WebSocket 鉴权
-   内部 API Key 调用（支持过期 + 吊销）
-   重要操作，如密码修改、recovery code生成、otp重置等需至少满足两种认证，passkey和otp属于同一个设备验证因此算一个验证方法
-   邮箱验证：发送随机验证码进行验证，验证后可使用邮箱登录，如已验证邮箱可作为第二认证方式
-   认证顺序 用户名、密码>邮箱>passkey/otp>恢复码
-   通知系统用户可指定哪些事件需要通知，通知方法暂时留接口，稍后要做通知系统添加多种通知方法
-   尤其内部API调用，为了方便没进行二次验证因此更需要注重安全设置

---

## 二、总体架构

用户 / 服务  
↓  
认证入口（password / passkey / oauth）  
↓  
OTP（二次验证)
↓  
创建 Session  
↓  
签发 JWT（包含 session_id）  
↓  
系统访问（REST / WebSocket / 内部）

---

## 三、登录方式

### 1. 用户名 + 密码（主方式）

POST /auth/login

---

### 2. Passkey（可选）

-   受后台开关控制
-   enable_passkey = false → 完全禁用

---

### 3. OAuth（未来扩展）

-   GitHub
-   Google

---

## 四、OTP（二次验证，强制）

### 核心规则

-   未开启 OTP → 禁止使用系统
-   登录必须通过 OTP

---

### OTP Secret 规则

-   secret 只在绑定时展示一次
-   后续不可查看
-   必须同时提供：
    -   二维码
    -   明文 secret（支持手动输入）

---

### ⭐ OTP 手动刷新 / 重置（新增）

系统不提供查看 secret 的能力，只允许“重置”：

#### 使用场景

-   用户更换设备
-   用户怀疑泄露
-   用户主动刷新

---

### 重置流程

发起重置  
↓  
身份验证（密码 / OTP / 恢复码）  
↓  
生成新 secret（旧 secret 立即失效）  
↓  
返回二维码 + secret  
↓  
用户验证新 OTP  
↓  
启用

---

### 安全规则

-   必须重新验证才能启用
-   不保留旧 secret
-   建议：重置后强制下线所有 session，可保留API KEY

---

## 五、恢复码

-   每个只能使用一次
-   一批生成多个
-   只展示一次
-   注册成功或第一次登录如未下载 recovery code 需强制下载，如未下载不能进行操作
-   每使用一次需提示用户已用恢复码失效及可用数量，如用完需强制重新生成
-    如在恢复密码时用户设备遗失或无法验证opt需提供之前使用过的密码作为验证

用途：

-   找回账号
-   重置 OTP
-   生成恢复码

---

## 六、Token 设计

-   默认有效期：7 天
-   用户可自定义
-   必须限制最大值（如 100 天）

---

## 七、Session 会话层（核心）

user_sessions：

-   id (session_id)
-   user_id
-   device_info
-   ip
-   created_at
-   expires_at
-   revoked

---

### 功能

-   多设备登录
-   踢人下线（revoke）

---

## 八、WebSocket 鉴权

ws://host/ws?token=xxx

需校验：

-   JWT
-   session

---

## 九、API Key（内部调用）

### 数据库

api_keys：

-   id
-   key_hash（不存明文）
-   name
-   created_at
-   expires_at
-   revoked

---

### ⭐ API Key 管理能力（新增）

-   支持设置过期时间（expires_at）
-   支持人工 revoke（立即失效）和delete
-   支持多个 key
-   必须 hash 存储（安全）

---

### 校验规则

-   key 存在
-   未 revoked
-   未过期

---

## 十、Passkey 

-   无需注册可直接登录，自动注册
-   需考虑设备遗失的情况或设备被盗用的问题

---

## 十一、完整认证链路

登录方式  
↓  
OTP 验证  
↓  
Session 创建  
↓  
JWT Token  
↓  
访问系统

---

## 十二、系统总结

-   JWT：身份标识
-   Session：登录控制（踢人）
-   OTP：安全验证（支持重置）
-   恢复码：兜底机制
-   API Key：内部调用控制（支持 revoke）

---

## 十三、一句话总结

JWT 负责身份，Session 负责控制，OTP 负责安全，恢复码负责兜底，API Key 负责系统访问控制
