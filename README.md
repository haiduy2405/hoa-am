# Hòa Âm

Nối đàn organ (đã thử thiết kế cho Yamaha PSR-S975) qua USB, chơi đến đâu Hòa Âm đọc hợp âm đến đó. Ghi lại thành bản hợp âm có ô nhịp và lời, nghe lại, xuất file.

Chạy hoàn toàn trên trình duyệt, không cần cài gì, không gửi dữ liệu đi đâu.

## Dùng thế nào

1. Mở trang bằng **Chrome hoặc Edge** trên máy tính (Safari và Firefox hỗ trợ Web MIDI hạn chế).
2. Nối đàn vào máy qua cổng **USB TO HOST**, bật đàn. Cho phép trang dùng MIDI khi trình duyệt hỏi.
3. Chơi một hợp âm: tên hợp âm hiện to ở giữa, kèm các cách đọc khác và vị trí trong tông.
4. Bấm **Ghi**, đếm vào một ô nhịp, chơi tiếp. Hợp âm tự rơi vào đúng ô nhịp và phách.
5. Bấm vào ô nhịp hoặc hợp âm để sửa. Bấm **Phát** để nghe lại, **Xuất file** để lấy bản chữ, MIDI, PDF.

Chưa có đàn? Chơi thử bằng chuột trên phím bên dưới, hoặc bàn phím máy tính (A W S E D F T G Y H U J K, Z và X đổi quãng tám).

## Tính năng

- Đọc hợp âm theo thời gian thực: tam hợp âm, hợp âm bảy, sus, add9, dim, aug, power chord, hợp âm đảo và slash chord (C/E). Có chế độ đầy đủ cho 9, 11, 13 và biến âm.
- Cho nhiều cách đọc khi nhập nhằng (Am7 hay C6/A), bấm để chọn cách đọc khác.
- Lọc kênh MIDI để phần đệm style của đàn không làm nhiễu việc đọc hợp âm, có vạch báo kênh đang gửi nốt.
- Ghi hợp âm với metronome, đếm vào, làm tròn nhịp (tự do, nửa phách, phách, nửa ô nhịp, ô nhịp), gõ nhịp để lấy tempo.
- Bản hợp âm theo ô nhịp: sửa hợp âm bằng cách gõ tên hoặc bấm chọn, thêm tên đoạn, lời bài hát, hoàn tác và làm lại.
- Tự đoán tông (Đô trưởng, La thứ...), hiện số La Mã dưới mỗi hợp âm, đánh dấu hợp âm ngoài tông.
- Gợi ý hợp âm kế tiếp theo tông và chức năng hòa âm, bấm để nghe, bấm dấu cộng để thêm vào bài.
- Chuyển tông, tự chọn thăng hoặc giáng theo tông của bài.
- Phát lại qua trình duyệt hoặc qua loa của đàn (MIDI out), có lặp.
- Xuất: sao chép chữ, .txt, .mid, .json, in hoặc lưu PDF. Lưu tự động nhiều bài trên trình duyệt.

## Chạy trên máy

Cần một web server tĩnh vì dùng ES module (mở thẳng file `index.html` sẽ bị chặn):

```bash
python3 -m http.server 8000
# rồi mở http://localhost:8000
```

Web MIDI chỉ chạy trên `https://` hoặc `localhost`.

## Test

```bash
npm test
```

Test phủ phần nhận diện hợp âm, đọc tên hợp âm, đoán tông, số La Mã, gợi ý, voicing và xuất file.

## Cấu trúc

| File | Việc nó làm |
|---|---|
| `js/engine.js` | Nhận diện hợp âm, tên nốt, đoán tông, số La Mã, gợi ý, voicing |
| `js/model.js` | Mô hình bản nhạc: ô nhịp, hợp âm theo phách |
| `js/midi.js` | Bọc Web MIDI, tự tìm đàn Yamaha |
| `js/audio.js` | Synth và metronome bằng WebAudio |
| `js/keyboard.js` | Phím đàn trên màn hình |
| `js/export.js` | Xuất chữ và MIDI |
| `js/store.js` | Lưu cài đặt và bản nhạc trên trình duyệt |
| `js/app.js` | Giao diện và nối các phần lại |

## Ghi chú về đàn

- Phần tay phải và tay trái của đàn Yamaha thường gửi ở kênh 1 đến 3, phần đệm style ở kênh cao hơn. Mặc định app chỉ nghe kênh 1 đến 3, đổi ở nút **Kênh nhận**.
- Yamaha gọi phím giữa là C3, chuẩn quốc tế gọi là C4. Mặc định app theo Yamaha, đổi trong Cài đặt.
- Trên Windows, nếu không thấy đàn, cài Yamaha Steinberg USB Driver và đóng các phần mềm khác đang giữ cổng MIDI.
