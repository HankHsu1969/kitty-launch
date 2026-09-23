# 萌喵彈射大作戰 Kitty Launch vs. Angry Cats

類似憤怒鳥的網頁彈射遊戲：發射可愛小貓，擊垮憤怒貓蓋的高塔。共 10 關，由簡單到最難。

## 執行

```bash
python -m http.server 8765
```

然後開啟 http://localhost:8765 （物理引擎 Matter.js 由 CDN 載入，需要網路）。

## 操作

- 拖曳彈弓上的小貓，放開發射
- 飛行中點一下畫面（或按空白鍵）使用特殊能力
- `R` 重玩、`Esc` 暫停；網址加 `?unlock` 可解鎖全部關卡

## 小貓

| 小貓 | 能力 |
|---|---|
| 橘子 | 普通小貓 |
| 灰灰 | 分身成三隻，擅長撞冰塊 |
| 奶茶 | 高速衝刺，擅長撞木頭 |
| 煤球 | 爆炸 |
| 棉花 | 變成巨大胖貓，擅長撞石頭 |

## 結構

- `index.html`、`style.css` — 畫面與介面
- `js/game.js` — 遊戲主程式（物理、繪圖、輸入、存檔）
- `js/levels.js` — 10 個關卡資料
- `js/audio.js` — Web Audio 即時合成的音效與背景音樂
- `assets/` — 美術素材（Higgsfield GPT Image 2 生成）
