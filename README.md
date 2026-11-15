# Nốt Rơi

Mở file MIDI, phát qua đàn organ của bạn (thiết kế cho Yamaha PSR-S975, nối USB), chỉnh âm sắc và âm lượng từng phần, đổi tông, tải lại, và học bài với nốt rơi như game.

Chạy hoàn toàn trên trình duyệt, không cần cài gì, không gửi dữ liệu đi đâu.

## Dùng thế nào

1. Mở trang bằng **Chrome hoặc Edge** trên máy tính (Safari và Firefox hỗ trợ Web MIDI hạn chế). Nối đàn qua cổng **USB TO HOST**, bật đàn, cho phép MIDI khi trình duyệt hỏi.
2. Bấm **Mở file MIDI** (hoặc kéo thả file .mid vào trang). App đọc hết các nhạc cụ, tempo, nhịp, pedal. Bài tự lưu trong **Bản nhạc của tôi**, lần sau mở lại tự vào bài đang dở.
3. Bấm **Phát** (hoặc phím Space): bài chỉ phát qua cổng MIDI out của đàn. Chưa nối đàn thì app báo và mở hộp thoại kết nối. Kéo thanh tua để chọn chỗ phát, **Lặp** để phát lại liên tục. Mỗi phần có dải nốt nhìn nhanh và vạch chạy theo bài.
4. Chỉnh từng phần: đổi âm sắc (128 âm sắc GM), âm lượng, tắt tiếng (M), chỉ nghe phần này (S), xóa phần. Cả bài: đổi tempo, đổi tông −12, −1, +1, +12 (phần trống giữ nguyên), Hoàn tác (Ctrl+Z) và Làm lại.
5. **Tải file .mid** lưu bài đã chỉnh (nhiều track, giữ tempo, pedal, bánh pitch).
6. **Học bài này** để tập với nốt rơi (bên dưới). Đang học vẫn đổi được file bằng nút **Mở file khác**.

Nốt Rơi không phát âm thanh qua loa máy tính (trừ tiếng bíp đếm ngược khi học): mọi tiếng nhạc đều đi qua đàn.

### Học bài theo nốt rơi

Bấm **Học bài này** sau khi mở bài. Nốt rơi xuống phím đàn như Synthesia hay Piano Above All.

- **Đợi tôi:** bài đứng yên ở mỗi nốt hoặc hợp âm tay bạn cần chơi, bạn bấm đúng trên đàn thì bài mới chạy tiếp. Tay còn lại, đệm và trống do đàn tự chơi qua MIDI out.
- **Thử thách** (chế độ game): đếm ngược 3, 2, 1, BẮT ĐẦU to giữa màn hình (bài đứng yên, chưa phát nốt nào), xong mới chạy bài; nốt đầu tiên cần khoảng 3 giây để rơi xuống phím nên kịp đặt tay (chế độ Đợi tôi cũng vậy). Bạn bấm đúng nốt đúng lúc để ghi điểm.
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
- Nốt bạn chơi nhận từ cổng MIDI vào của đàn, theo các kênh đã chọn ở **Kết nối đàn** (mặc định kênh 1 đến 3).

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

Test phủ đọc và ghi file MIDI (running status, tempo map, pedal), sửa nốt, đổi tempo, lưu gọn.

## Cấu trúc

| File | Việc nó làm |
|---|---|
| `js/midi.js` | Bọc Web MIDI, tự tìm đàn Yamaha |
| `js/songmidi.js` | Đọc và ghi file MIDI, sửa nốt, đổi tông và tempo |
| `js/player.js` | Lập lịch phát bản MIDI qua MIDI out của đàn |
| `js/learn.js` | Học bài: nốt rơi, chế độ đợi, thử thách, phân tay |
| `js/midiui.js` | Giao diện phòng nhạc MIDI |
| `js/export.js` | Tải file về máy |
| `js/version.js` | Số phiên bản và tên tác giả (duyluma) |
| `js/store.js` | Lưu cài đặt và các bài MIDI trên trình duyệt |
| `js/app.js` | Hộp thoại, kéo thả, chế độ app, nối các phần lại |

## Ghi chú về đàn

- Phần tay phải và tay trái của đàn Yamaha thường gửi ở kênh 1 đến 3, phần đệm style ở kênh cao hơn. Mặc định app chỉ nghe kênh 1 đến 3 khi học bài, đổi ở hộp thoại **Kết nối đàn**.
- Yamaha gọi phím giữa là C3, chuẩn quốc tế gọi là C4. Mặc định app theo Yamaha, đổi trong Cài đặt.
- Trên Windows, nếu không thấy đàn, cài Yamaha Steinberg USB Driver và đóng các phần mềm khác đang giữ cổng MIDI.

## Chạy như app

- Toàn màn hình do bạn tự bật (F11 trên trình duyệt, hoặc cài app để mở từ biểu tượng là toàn màn hình).
- Không bôi đen, không nhấp đúp chọn chữ, không menu chuột phải (trừ trong ô nhập chữ như tên bài).
- **Cài app**: bấm nút "Cài app" ở thanh trên (Chrome/Edge), hoặc menu trình duyệt > Cài đặt ứng dụng. Mở từ biểu tượng là toàn màn hình luôn.

## Màn hình và cập nhật

- Chỉ dùng trên máy tính. Cỡ chữ gốc co giãn theo cửa sổ (16px ở 1600x900, 25,6px ở 2560x1440, tối đa 40px), mọi kích thước tính theo rem nên cả app, kể cả canvas nốt rơi, lớn theo màn hình.
- Cứ 20 giây và mỗi lần quay lại cửa sổ, app hỏi máy chủ số phiên bản. Có bản mới thì hiện hộp thoại không đóng được, bấm **Cập nhật ngay** để tải lại. Bài đang mở được lưu trước đó.
- Service worker luôn hỏi lại máy chủ (no-cache), nên bản mới đẩy lên là dùng ngay, không bị kẹt bộ nhớ đệm 10 phút của GitHub Pages. Phần còn lại là thời gian GitHub tự triển khai.
