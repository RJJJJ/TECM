# 測試與 Release Gate

## 證據分類

| 分類 | 可以證明 | 不可以證明 |
|---|---|---|
| 自動測試 | migration/RLS/RPC、Web build/unit、mock sender、payload safety | Apple entitlement 或真實交付 |
| Simulator | deep link、foreground/tap UI、fixture payload | APNs network/device token |
| macOS runner | package resolve、Xcode compile、Swift tests | production signing/TestFlight |
| Apple credential | token auth、sandbox/production endpoint | 最終裝置 UX（若無真機） |
| 真實 iPhone | permission、token、foreground/background/tap | 完整產品驗收 |
| 人工產品驗收 | 文案、角色流程、營運可用性 | 自動安全不變量 |

## Windows/Linux 可執行 gate

```powershell
./scripts/testing/database-verify.ps1
Set-Location admin-web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
Set-Location ..
node scripts/testing/validate-n8n.mjs
node scripts/testing/repository-security-scan.mjs
```

Live E2E 需先 `supabase start`、`supabase db reset` 並提供本機 seed account；不得使用真實家長 Email。

## macOS CI gate

GitHub Actions 在 macOS runner 執行 package resolution、unsigned simulator build 和 Swift tests。一般 PR 不需 production signing，不使用 Apple repo secret。未取得成功 run 前，Xcode 狀態只能是 pending/blocked。

## APNs gate

1. mock：200、429、500、410、BadDeviceToken、timeout、duplicate claim、max retry/dead-letter、payload privacy、endpoint selection。
2. dry-run：Edge Function claim + `would_send`，不需 `.p8`。
3. sandbox：development-signed 真機。
4. TestFlight：production token + 真機，驗證 foreground、background、tap route、badge、登出停用。

沒有 Apple credential、provisioning 或真實 iPhone evidence 時，第 3/4 步必須標記 blocked。

## 人工驗收

- 邀請既有 parent、重發、接受、停用；確認沒有 duplicate Auth user/link。
- parent 只見自己 organization/children；跨 tenant URL/RPC 被拒。
- admin 建立公告、預覽、預計接收人數、delivery summary；畫面不顯示 token。
- parent 查看通知、單一/全部已讀、重新連線後 badge 校正。
- teacher 點名與既有營運 Web flow 無 regression。
- 未知 deep link 安全返回通知中心。

## Release 禁止事項

不 merge main、不 production deploy、不向真實家長發送 Email/push/WhatsApp/WeChat、不提交 `.env`、`.p8`、service-role、certificate、provisioning profile、Xcode user state、Playwright report 或 Codex/OMX runtime 檔案。
