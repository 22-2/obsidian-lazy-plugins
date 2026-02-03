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

## 対象ファイル候補（次の作業）
- [src/settings.ts](src/settings.ts)
- [src/services/settings-service.ts](src/services/settings-service.ts)
- [src/services/plugin-registry.ts](src/services/plugin-registry.ts)
- [src/main.ts](src/main.ts)
- （必要なら）[myfiles/setViewState.js](myfiles/setViewState.js)

