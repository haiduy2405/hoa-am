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

## Nhạc MIDI: mở file, nghe, sửa, làm thành bài của mình

1. Bấm **Mở file MIDI** (hoặc kéo thả file .mid vào trang). App đọc hết các nhạc cụ, tempo, nhịp, pedal và tự đoán hợp âm vào bản nhạc.
2. Bấm **Phát** để nghe bằng trình duyệt, hoặc bật **Phát qua đàn** để nghe bằng âm thanh thật của đàn (cần nối MIDI out).
3. Sửa trên piano roll: bấm đúp để thêm nốt, kéo để dời, kéo mép phải để đổi độ dài, kéo khung để chọn nhiều nốt, kéo ở dải Lực nhấn để đổi độ mạnh. Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+D, phím mũi tên, Delete đều dùng được.
4. Đổi âm sắc từng phần (128 âm sắc GM), tắt tiếng hoặc solo, làm tròn nhịp theo lưới, chuyển tông từng phần hoặc cả bài, đổi tempo, thêm phần nhạc cụ hoặc trống mới.
5. **Lấy hợp âm vào bản nhạc** đọc hợp âm từ các phần bạn chọn. **Thêm phần hợp âm** làm ngược lại: biến bản hợp âm của bạn thành một phần đệm.
6. **Tải file .mid** lưu bài đã sửa (nhiều track, giữ tempo, pedal, bánh pitch) để mở tiếp trong phần mềm thu âm.

Giới hạn: không đọc file dùng mốc thời gian SMPTE, không phát được âm thanh thật của từng nhạc cụ khi nghe bằng trình duyệt (synth đơn giản; muốn đúng âm sắc hãy phát qua đàn), file tối đa 8 MB. Bài rất lớn có thể vượt dung lượng lưu tự động của trình duyệt, khi đó app báo và bạn nên tải .mid về.

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

Test phủ nhận diện hợp âm, đoán tông, số La Mã, gợi ý, voicing, xuất file, và đọc ghi file MIDI (running status, tempo map, pedal, lấy hợp âm từ nốt).

## Cấu trúc

| File | Việc nó làm |
|---|---|
| `js/engine.js` | Nhận diện hợp âm, tên nốt, đoán tông, số La Mã, gợi ý, voicing |
| `js/model.js` | Mô hình bản nhạc: ô nhịp, hợp âm theo phách |
| `js/midi.js` | Bọc Web MIDI, tự tìm đàn Yamaha |
| `js/audio.js` | Synth và metronome bằng WebAudio |
| `js/keyboard.js` | Phím đàn trên màn hình |
| `js/export.js` | Xuất chữ và MIDI dãy hợp âm |
| `js/songmidi.js` | Đọc và ghi file MIDI, sửa nốt, lấy hợp âm từ nốt |
| `js/player.js` | Lập lịch phát bản MIDI |
| `js/roll.js` | Piano roll bằng canvas |
| `js/midiui.js` | Giao diện phòng nhạc MIDI |
| `js/store.js` | Lưu cài đặt và bản nhạc trên trình duyệt |
| `js/app.js` | Giao diện và nối các phần lại |

## Ghi chú về đàn

- Phần tay phải và tay trái của đàn Yamaha thường gửi ở kênh 1 đến 3, phần đệm style ở kênh cao hơn. Mặc định app chỉ nghe kênh 1 đến 3, đổi ở nút **Kênh nhận**.
- Yamaha gọi phím giữa là C3, chuẩn quốc tế gọi là C4. Mặc định app theo Yamaha, đổi trong Cài đặt.
- Trên Windows, nếu không thấy đàn, cài Yamaha Steinberg USB Driver và đóng các phần mềm khác đang giữ cổng MIDI.
