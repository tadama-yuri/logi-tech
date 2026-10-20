# ドライバー稼働時間分析アプリ

ドライバーの勤務実績と荷待ち時間を記録し、スマートフォンで稼働状況を確認するための PWA 試作です。Android の Chrome で開き、「ホーム画面に追加」するとアプリのように利用できます。

## 起動方法

Node.js がある場合、リポジトリのルートで次を実行します。

```sh
npx serve .
```

表示された URL を Android と同じネットワークの端末で開くか、GitHub Pages に公開してアクセスしてください。インストールとオフラインキャッシュには HTTPS が必要です。ローカル確認は `http://localhost` でも可能です。

## 画面

- ログイン: 試作用ユーザーを選択して開始。ヘッダーからログアウトして戻る
- データ入力: 勤務開始・終了、休憩・荷待ちをワンタップで記録。従来の手入力にも対応
- 勤務記録: 保存済み記録の確認。運行管理者は全件、その他の利用者は自分の記録のみ編集・削除
- 分析結果: 稼働率、荷待ち時間、ドライバー別集計
- ユーザー管理: 運行管理者のみ閲覧・追加・削除可能

## 3人での GitHub 開発

`main` は保護し、作業ごとに `feature/<担当>-<機能>` ブランチを作成して Pull Request 経由で統合してください。画面ごとの実装は `screens/` に分かれているので、担当画面のファイルを中心に編集できます。

- メンバーA: `screens/entry.js`、`screens/templates/entry.html`、`styles/screens/entry.css`（入力画面）
- メンバーB: `screens/records.js`、`screens/analytics.js` と対応する HTML・CSS（記録・分析）
- メンバーC: `screens/login.js`、`screens/admin.js` と対応する HTML・CSS（ログイン・ユーザー管理）

HTML は `screens/templates/`、画面別 CSS は `styles/screens/` に分かれています。`shared/templates/shell.html` が共通シェル、`styles/base.css` と `styles/layout.css` が共通スタイルです。`main.js` は画面切替、`shared/data.js` はデータ形式・計算、`shared/layout.js` は共通レイアウトを担当します。共通ファイルを変更するときは、先に3人で相談してください。

仕様のたたき台は [docs/requirements.md](docs/requirements.md) にあります。担当や画面はチームで調整してください。

## 試作上の制約

データは利用中のブラウザーの `localStorage` に保存され、端末間では同期されません。ログインは画面遷移用のデモであり、認証・権限管理・サーバー保存は未実装です。実運用前にバックエンド、認証、バックアップ、個人情報の取り扱いを設計してください。