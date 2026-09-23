# Staging 測試帳號建立 Runbook

本文件只適用於 staging 或本機合成資料。不得在 production 執行，也不得使用真實兒童資料。帳號密碼、service-role key、access token 或 reset link 均不得寫入 Git、工單、截圖或測試報告。

## 先分清三類資料

- Auth user 是登入身份，由 Supabase Auth 管理；它本身不代表任何 TECM 權限。
- `organization_members` 是職員在某一機構內的角色與啟用狀態。Admin、Staff、Teacher 必須各自有 Auth user 及同一機構內的 active membership。
- Parent 使用 `parent_profiles` 表示家長業務身份，並以唯一 `user_id` 連至一個 Auth user；其學生權限來自 `parent_student_links`。Parent 不應加入職員 membership。

同一 Auth 身份不得覆蓋另一個 parent profile，不得跨 organization 重用；如遇衝突，停止操作並由管理員核對 audit，而不是修改唯一性或 RLS。

## 建立 Admin、Staff、Teacher 測試帳號

1. 在 staging 的受控 Auth 管理介面向合成測試電郵發出一次性邀請，不要由職員設定或保管永久密碼。
2. 取得新 Auth user ID 後，由既有 Admin 在目標 organization 建立對應 membership：Admin 用 `admin`、Staff 用 `staff`、Teacher 用 `teacher`，狀態設為 `active`。
3. Teacher 另需同 organization 的 `teacher_profiles` row。使用後台的受控導師建立流程，讓 membership 與 profile 原子化建立；不要直接改身份唯一鍵。
4. 分別登入驗證：Admin 可見完整營運 Dashboard；Staff 只見產品授權的營運功能；Teacher 登入 `/admin` 會前往課堂頁，直接開 Dashboard 亦不會讀取或顯示財務資料。

## 建立 Parent 測試帳號

1. 先以合成姓名建立家長、學生及同 organization 的初始 `parent_student_links`，此時 parent profile 可保持 `unlinked`。
2. 在「家長帳戶」的「邀請／建立新家長身份」區輸入合成測試電郵並發出一次性邀請。
3. 家長完成 Auth 驗證後，確認 parent profile 為 `active`，且唯一 `user_id` 指向該 Auth user。不要建立 organization membership。
4. 家長 App 登入後，確認只讀到已連結學生的課堂、請假與結果。

## 一個現有家長連結多名學生

1. 確認家長帳戶已啟用，且另一名學生為目前 organization 的 active 合成學生。
2. 在「家長帳戶」的「將現有家長連結另一名學生」區選擇家長及學生，提交「連結學生」。重送相同連結應顯示成功且不新增第二 row。
3. 不要建立第二個 Auth user 或第二個 parent profile。App 應顯示兩名學生，但每名學生只顯示其獲授權資料。
4. 移除單一連結時核對確認提示；操作會寫入 append-only audit。移除後家長帳戶及其他學生連結保持啟用。

## 收尾及安全

- 測試密碼只可由 CI 或操作員在執行時產生並透過秘密管理傳入，完成後立即撤銷或輪換。
- production 一律建議一次性邀請／重設流程；不建議任何職員知道或保存家長、導師或其他職員的永久密碼。
- 發現身份衝突、跨租戶資料或 audit 不完整時立即停止，不得以 service-role 繞過產品流程修補資料。
