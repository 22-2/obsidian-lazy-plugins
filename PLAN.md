# 実装計画（Lazy with View）

## 目的
- `setViewState`でリーフにviewがセットされたタイミングで、対象プラグインを自動ロードする。
- 自動検出は避け、手動の対応表でシンプルに制御する。
- ロード/アンロードの複雑さを最小化する。

## 方針（シンプル優先）
1. **PluginModesに`LazyWithView`を追加**
   - 既存の`Lazy`とは別モードとして扱う。
2. **手動マッピングを追加**
   - `pluginId -> viewTypes[]` を設定で明示。
   - 自動的に`viewRegistry`から収集しない。
3. **ロードのみ自動化**
   - `setViewState`でviewが確定する瞬間に、該当プラグインが未ロードならロード。
   - アンロードは従来の手動/既存ポリシーに任せる（自動アンロードはしない）。
4. **最小フック**
   - `setViewState`内でviewType判定→`LazyWithView`対象のプラグインIDを解決→ロード。

## 具体的な実装ステップ
1. **設定モデルの拡張**
   - `PluginModes`に`LazyWithView`を追加。
   - 設定に`lazyWithView: Record<pluginId, string[]>`を追加。
2. **プラグイン管理サービスの拡張**
   - `viewType -> pluginId[]` の逆引きヘルパーを追加。
   - `viewType`が一致したら、対象プラグインを`enablePlugin`/`loadPlugin`相当でロード。
3. **`setViewState`へのフック**
   - viewが生成された直後（`open(n)`完了後）に `viewType` を取得してロード処理を呼ぶ。
4. **安全策**
   - 既にロード済みの場合はスキップ。
   - ロード中の多重呼び出しはガード。
   - `LazyWithView`以外は無視。

## 受け入れ条件
- `LazyWithView`に設定されたプラグインが、指定ビューを開いた瞬間にロードされる。
- 自動検出は行わない。
- アンロードは自動で行わない（既存仕様のまま）。
- 既存の`Lazy`/`Manual`動作に影響しない。

## 実装上の注意点（シンプル維持）
- **「すべて読み込み終わったか」の判定は不要**
   - view表示のタイミングで対象プラグインを**必要時ロード**するだけで十分。
   - 複数ビューが同時に開く場合は**重複ロード防止**（in-flightガード）で対応。
- **自動アンロードはしない**
   - 自動アンロードは状態管理を複雑化しやすい。
   - viewが閉じられてもプラグインの副作用（コマンド/設定/イベント/キャッシュ）が残るため、安定性が下がる。
- **ロードは冪等に**
   - 同一プラグインへのロード要求が来ても、既にロード済みなら即スキップ。
   - ロード中は同じPromiseを返す形で多重起動を回避。
- **「全プラグイン一時ロード→リセット→再起動」は非推奨**
   - 一時ロードでも**副作用**（設定変更、キャッシュ作成、外部ファイル操作）が発生し得る。
   - `community-plugins`を書き換える運用は**ユーザー期待を崩しやすい**。
   - そもそも**再起動が必要な設計**になり、体験が重くなる。
- **`setViewState`フックは最小限に**
   - viewTypeが確定したタイミングでのみ判定。
   - view作成前にロードを強制しない（循環依存の回避）。

## 対象ファイル候補（次の作業）
- [src/settings.ts](src/settings.ts)
- [src/services/settings-service.ts](src/services/settings-service.ts)
- [src/services/plugin-registry.ts](src/services/plugin-registry.ts)
- [src/main.ts](src/main.ts)
- （必要なら）[myfiles/setViewState.js](myfiles/setViewState.js)

