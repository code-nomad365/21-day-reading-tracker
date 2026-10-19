# 21 天閱讀追蹤表 Notion API

此目錄包含 GitHub Pages 網頁使用的 Notion 同步後端。Notion 權杖只放在 Zeabur 的環境變數中，禁止寫進網頁或 Git。

## Zeabur 環境變數

- `NOTION_TOKEN`：Notion 內部連線的 API token。
- `NOTION_DATA_SOURCE_ID`：閱讀追蹤資料來源 ID。
- `APP_ACCESS_KEY`：此網頁的私人同步代碼，至少 32 個字元。
- `ALLOWED_ORIGIN`：`https://code-nomad365.github.io`
- `NOTION_VERSION`：可省略，預設使用目前 API 版本。
- `PORT`：由 Zeabur 提供。

在 Notion 內部連線中開啟讀取內容、更新內容能力，並只授權「21 天閱讀追蹤表」資料庫。網頁第一次連線時輸入私人同步代碼；代碼只存於該瀏覽器的 localStorage。
