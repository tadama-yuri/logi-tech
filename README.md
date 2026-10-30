# ドライバー稼働時間分析アプリ

ドライバーの勤務実績と荷待ち時間を記録し、スマートフォンで稼働状況を確認するための PWA 試作です。Android の Chrome で開き、「ホーム画面に追加」するとアプリのように利用できます。

## 起動方法

Node.js がある場合、リポジトリのルートで次を実行します。

```sh
npx serve .
```

表示された URL を Android と同じネットワークの端末で開くか、GitHub Pages に公開してアクセスしてください。インストールとオフラインキャッシュには HTTPS が必要です。ローカル確認は `http://localhost` でも可能です。

## 画面

- ログイン: デモではユーザー選択、Supabase 設定後はメールアドレスとパスワードで認証
- データ入力: 勤務開始・終了、休憩・荷待ちをワンタップで記録。従来の手入力にも対応し、未終了勤務の通知、同日重複の注意、保存前確認を表示
- 勤務記録: 保存済み記録の確認。日付・ドライバー・承認状況で絞り込み、管理者は全件、ドライバーは自分の分のみ閲覧・編集・削除。管理者の承認・差し戻しと変更履歴に対応
- 分析結果: 管理者のみ閲覧可能。稼働率、荷待ち時間、ドライバー別集計を確認
- ユーザー管理: 管理者のみ閲覧可能。Supabase 利用時のアカウント作成は Supabase 管理画面で行い、ドライバーごとの勤務予定日を登録

## 3人での GitHub 開発

`main` は保護し、作業ごとに `feature/<担当>-<機能>` ブランチを作成して Pull Request 経由で統合してください。画面ごとの実装は `screens/` に分かれているので、担当画面のファイルを中心に編集できます。

- メンバーA: `screens/entry.js`、`screens/templates/entry.html`、`styles/screens/entry.css`（入力画面）
- メンバーB: `screens/records.js`、`screens/analytics.js` と対応する HTML・CSS（記録・分析）
- メンバーC: `screens/login.js`、`screens/admin.js` と対応する HTML・CSS（ログイン・ユーザー管理）

HTML は `screens/templates/`、画面別 CSS は `styles/screens/` に分かれています。`shared/templates/shell.html` が共通シェル、`styles/base.css` と `styles/layout.css` が共通スタイルです。`main.js` は画面切替、`shared/data.js` はデータ形式・計算、`shared/layout.js` は共通レイアウトを担当します。共通ファイルを変更するときは、先に3人で相談してください。

仕様のたたき台は [docs/requirements.md](docs/requirements.md) にあります。担当や画面はチームで調整してください。

## Supabase 接続（無料枠で試す場合）

1. Supabase でプロジェクトを作成します。無料枠の利用条件・上限・休止条件は変更されることがあるため、利用前に Supabase の案内を確認してください。
2. Supabase の SQL Editor で [`supabase/schema.sql`](./supabase/schema.sql) の内容を実行します。既にこのアプリのスキーマを作成済みの場合は、代わりに [`supabase/schedule-migration.sql`](./supabase/schedule-migration.sql) を実行して勤務予定テーブルを追加してください。
3. Project Settings の API から Project URL と anon/public key を取得し、[`shared/supabase-config.js`](./shared/supabase-config.js) の `SUPABASE_URL` と `SUPABASE_ANON_KEY` に設定します。anon key はブラウザーに置く前提の公開キーです。**service_role key やパスワードは絶対に設定・公開しないでください。**このアプリは RLS でアクセスを制限します。
4. Supabase Authentication の Users からアカウントを追加します。新規アカウントは自動的にドライバー権限で作成されます。氏名を設定する場合はユーザーメタデータの `name` に入力します。
5. SQL を実行する前に作成済みのアカウントを初回管理者にする場合は、SQL Editor でプロフィールを作成します（メールアドレスを実際の値に置き換えてください）。SQL 実行後に作成したアカウントなら、既にプロフィールがあるため `INSERT` は不要で、`UPDATE` だけで管理者にできます。

   ```sql
   insert into public.profiles (id, name, role)
   select id,
     coalesce(nullif(raw_user_meta_data ->> 'name', ''), split_part(email, '@', 1)),
     '管理者'
   from auth.users
   where email = 'admin@example.com'
   on conflict (id) do update set role = excluded.role;
   ```

6. Supabase Authentication の URL Configuration で、公開先 URL を Site URL / Redirect URLs に設定します。HTTPS で公開してください。
7. テスト記録を登録する場合は、SQL Editor で [`supabase/seed_test_data.sql`](./supabase/seed_test_data.sql) を実行します。テストドライバーの過去4日分の勤務記録を登録し、勤務記録の監査トリガーも動作します。同じ SQL を再実行しても重複登録されません。

設定が空のままなら、アプリは従来どおり端末内のデモモードで動きます。Supabase を設定した後はログイン認証と保存先が切り替わります。デモ用の `localStorage` データは自動移行されません。

勤務データと勤務予定は Supabase に保存され、RLS によりドライバーは自分のデータ、管理者は全データを扱います。監査履歴はデータベーストリガーで作成し、アプリから直接編集できない設定です。ユーザーアカウントの追加・削除は Supabase Authentication で行い、管理者ロールの変更は権限を持つ担当者が SQL Editor から行ってください。

Supabase モードのユーザー管理画面では、管理者が表示名・メールアドレス・役割・初期パスワードを入力してアカウントを作成できます。確認メールは送らず、作成時にメール確認済みとして設定します。初期パスワードは本人へ安全な方法で伝えてください。アカウント作成 API は `supabase/functions/create-user/` にあり、呼び出し側のログイン状態と管理者ロールをサーバーで確認します。

勤務予定日は管理者がユーザー管理画面でドライバーごとに登録・削除します。予定日の翌日以降に勤務記録がない場合、ドライバー本人がアプリを開いたときに未入力日を画面内で通知します。通知はブラウザーのプッシュ通知ではありません。

分析画面の「自動レポート」は管理者だけが利用できます。レポートはアプリ内で集計値から生成し、個人名・メールアドレス・個別勤務記録を外部サービスへ送信しません。外部AIサービス、APIキー、Edge Function、Dockerは不要です。レポートは表示のみで、データ変更は行いません。

アプリ内のアカウント作成を有効にするには Supabase CLI で Edge Function をデプロイします。プロジェクトをリンクした後、リポジトリのルートから次を実行してください。Supabase の service role key は Edge Function の環境にだけ存在し、アプリの JavaScript には設定しません。

```sh
supabase link --project-ref tihqubtpjsrzxzqptcer
supabase functions deploy create-user
```

## デモモードの制約

Supabase の URL / anon key が未設定の場合は、データが利用中のブラウザーの `localStorage` に保存され、端末間では同期されません。ログインも画面遷移用のデモです。Supabase の無料枠は試作・小規模利用向けであり、バックアップ、利用条件、個人情報や労務データの保護要件を実運用前に確認してください。