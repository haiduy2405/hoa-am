# Hòa Âm

Nối đàn organ (đã thử thiết kế cho Yamaha PSR-S975) qua USB, chơi đến đâu Hòa Âm đọc hợp âm đến đó. Thêm vào bản hợp âm có ô nhịp và lời, xuất file. Có thêm phòng nhạc MIDI để mở, sửa và phát bài qua chính cây đàn.

Chạy hoàn toàn trên trình duyệt, không cần cài gì, không gửi dữ liệu đi đâu.

## Dùng thế nào

1. Trang chủ giới thiệu ba khu làm việc: Hợp âm, Nhạc MIDI, Học bài. Mở trang bằng **Chrome hoặc Edge** trên máy tính (Safari và Firefox hỗ trợ Web MIDI hạn chế).
2. Nối đàn vào máy qua cổng **USB TO HOST**, bật đàn. Cho phép trang dùng MIDI khi trình duyệt hỏi.
3. Chơi một hợp âm: tên hợp âm hiện to ở giữa, kèm các cách đọc khác và vị trí trong tông.
4. Bấm **Thêm vào bản hợp âm** (hoặc dấu cộng ở gợi ý) để đưa hợp âm vào ô nhịp.
5. Bấm vào ô nhịp hoặc hợp âm để sửa. **Xuất file** để lấy bản chữ, MIDI, PDF.

Phím đàn trên màn hình chỉ để nhìn, không phát tiếng. Hòa Âm không phát âm thanh qua loa máy tính: mọi tiếng đều đi qua đàn.

## Tính năng

- Đọc hợp âm theo thời gian thực: tam hợp âm, hợp âm bảy, sus, add9, dim, aug, power chord, hợp âm đảo và slash chord (C/E). Có chế độ đầy đủ cho 9, 11, 13 và biến âm.
- Cho nhiều cách đọc khi nhập nhằng (Am7 hay C6/A), bấm để chọn cách đọc khác.
- Lọc kênh MIDI để phần đệm style của đàn không làm nhiễu việc đọc hợp âm, có vạch báo kênh đang gửi nốt.
- Bản hợp âm theo ô nhịp: sửa hợp âm bằng cách gõ tên hoặc bấm chọn, thêm tên đoạn, lời bài hát, hoàn tác và làm lại.
- Tự đoán tông (Đô trưởng, La thứ...), hiện số La Mã dưới mỗi hợp âm, đánh dấu hợp âm ngoài tông.
- Gợi ý hợp âm kế tiếp theo tông và chức năng hòa âm, bấm để nghe, bấm dấu cộng để thêm vào bài.
- Chuyển tông, tự chọn thăng hoặc giáng theo tông của bài.
- Bấm hợp âm gợi ý để nghe thử qua đàn.
- Xuất: sao chép chữ, .txt, .mid, .json, in hoặc lưu PDF. Lưu tự động nhiều bài trên trình duyệt.

## Nhạc MIDI: mở file, nghe, sửa, làm thành bài của mình

1. Bấm **Mở file MIDI** (hoặc kéo thả file .mid vào trang). App đọc hết các nhạc cụ, tempo, nhịp, pedal và tự đoán hợp âm vào bản nhạc.
2. Bấm **Phát** (hoặc phím Space): bài chỉ phát qua cổng MIDI out của đàn. Chưa nối đàn thì app báo và mở hộp thoại kết nối.
3. Bấm **Toàn màn hình** (hoặc phím F, Esc để thoát) để tập trung vào piano roll. Sửa trên piano roll: bấm đúp để thêm nốt, kéo để dời, kéo mép phải để đổi độ dài, kéo khung để chọn nhiều nốt, kéo ở dải Lực nhấn để đổi độ mạnh. Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+D, phím mũi tên, Delete đều dùng được.
4. Đổi âm sắc từng phần (128 âm sắc GM), tắt tiếng hoặc solo, làm tròn nhịp theo lưới, chuyển tông từng phần hoặc cả bài, đổi tempo, thêm phần nhạc cụ hoặc trống mới.
5. **Lấy hợp âm vào bản nhạc** đọc hợp âm từ các phần bạn chọn. **Thêm phần hợp âm** làm ngược lại: biến bản hợp âm của bạn thành một phần đệm.
6. **Tải file .mid** lưu bài đã sửa (nhiều track, giữ tempo, pedal, bánh pitch) để mở tiếp trong phần mềm thu âm.

### Học bài theo nốt rơi

Bấm **Học bài này** trong phòng nhạc MIDI. Nốt rơi xuống phím đàn như Synthesia hay Piano Above All.

- **Đợi tôi:** bài đứng yên ở mỗi nốt hoặc hợp âm tay bạn cần chơi, bạn bấm đúng trên đàn thì bài mới chạy tiếp. Tay còn lại, đệm và trống do đàn tự chơi qua MIDI out.
- **Thử thách** (chế độ game): bài chạy đều sau khi đếm ngược 3, 2, 1 to giữa màn hình (chế độ Đợi tôi cũng đếm ngược). Bạn bấm đúng nốt đúng lúc để ghi điểm.
  - Chấm theo độ lệch: PERFECT (trong 70 ms), GREAT (130 ms), GOOD (220 ms), quá thì MISS. Kèm nhãn Sớm hoặc Trễ.
  - **PERFECT liên tiếp không giới hạn.** Điểm nhân ×2, ×3, ×4 theo chuỗi, từ ×4 trở đi không nhân thêm nữa; thay vào đó cứ mỗi 10 PERFECT liên tiếp được thưởng thêm 1.000 điểm cố định. Số ×N dưới chữ PERFECT là độ dài chuỗi thật (×12, ×25…), đổi màu theo mốc. Bấm GREAT, GOOD, trượt hoặc bấm sai nốt thì chuỗi về 0. Một hợp âm nhiều nốt tính là một nhịp.
  - **Fever:** thanh đầy thì vào Fever 8 giây, điểm nhân thêm đôi (đang ×4 thì thành ×8). Trượt nốt là Fever dừng.
  - Chữ PERFECT có hiệu ứng riêng: chữ vàng gradient, dải sáng quét qua, tia sáng xoay phía sau, vệt sáng ngang và sao lấp lánh.
  - Hiệu ứng: tia sáng từ phím, vòng sóng, hạt lấp lánh, loé đỏ khi trượt, viền hồng khi Fever. Có thể tắt hiệu ứng ở mục Phân tay.
  - Hết bài hiện hạng S, A, B, C, D, số sao, điểm đếm lên và kỷ lục riêng cho từng bài (theo tay tập và tốc độ), lưu trên trình duyệt.
  - Đếm ngược 3, 2, 1 có âm thanh bíp (file `assets/countdown.mp3`) khớp từng số, phát ra loa máy tính, tắt được ở mục Phân tay. Ngoài ra không có âm thanh hiệu ứng nào: mọi tiếng nhạc đều từ đàn của bạn.
- **Xem:** đàn tự chơi cả bài, bạn nhìn nốt rơi để học trước.
- Tập **tay phải**, **tay trái** hoặc **hai tay**. Tập tay nào thì tay kia tự chơi nhỏ lại (40%) cho dễ nghe, chỉnh lại được. Mục **Phân tay** cho chọn phần nào là tay nào, hoặc chia một phần piano thành hai tay tại một nốt.
- Tốc độ và âm lượng đàn tự chơi (tay phải, tay trái, đệm) chọn trong 10 mốc từ 10% đến 100%. Lặp một đoạn theo ô nhịp, kéo thanh để tua, độ dài đường rơi, số phím, toàn màn hình (phím F), Space để dừng và tiếp tục, R về đầu.
- Nốt bạn chơi nhận từ cổng MIDI vào của đàn, theo các kênh đã chọn ở **Kênh nhận** (mặc định kênh 1 đến 3).

Giới hạn: không đọc file dùng mốc thời gian SMPTE, phát bài cần đàn nhận nốt MIDI từ USB (đàn phải bật và chọn đúng cổng ra), file tối đa 8 MB. Bài rất lớn có thể vượt dung lượng lưu tự động của trình duyệt, khi đó app báo và bạn nên tải .mid về.

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
| `js/keyboard.js` | Phím đàn trên màn hình (chỉ hiển thị) |
| `js/export.js` | Xuất chữ và MIDI dãy hợp âm |
| `js/songmidi.js` | Đọc và ghi file MIDI, sửa nốt, lấy hợp âm từ nốt |
| `js/player.js` | Lập lịch phát bản MIDI qua MIDI out của đàn |
| `js/roll.js` | Piano roll bằng canvas |
| `js/learn.js` | Học bài: nốt rơi, chế độ đợi, theo nhịp, phân tay |
| `js/midiui.js` | Giao diện phòng nhạc MIDI |
| `js/version.js` | Số phiên bản và tên tác giả (duyluma) |
| `js/store.js` | Lưu cài đặt và bản nhạc trên trình duyệt |
| `js/app.js` | Giao diện và nối các phần lại |

## Ghi chú về đàn

- Phần tay phải và tay trái của đàn Yamaha thường gửi ở kênh 1 đến 3, phần đệm style ở kênh cao hơn. Mặc định app chỉ nghe kênh 1 đến 3, đổi ở nút **Kênh nhận**.
- Yamaha gọi phím giữa là C3, chuẩn quốc tế gọi là C4. Mặc định app theo Yamaha, đổi trong Cài đặt.
- Trên Windows, nếu không thấy đàn, cài Yamaha Steinberg USB Driver và đóng các phần mềm khác đang giữ cổng MIDI.
