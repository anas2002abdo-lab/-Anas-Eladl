# تطبيقات الموبايل – اطلبها (Otlobha Customer & Captain Apps)

هذا المجلد يحتوي على الكود المصدري الكامل لتطبيقي الموبايل بـ **Flutter (Android & iOS)** متصلين مباشرةً بخادم **اطلبها** وخرائط **OpenStreetMap** المجانية:

1. `/mobile/otlobha_customer` — **تطبيق اطلبها الرئيسي للعملاء** (المتاجر، الطلب الحر، الصيدلية والروشتات المصورة، اطلبها أي حاجة بـ OTP، اطلبها مشوار، سوق اطلبها C2C، المحفظة والكوبونات، وصندوق الإشعارات الفوري).
2. `/mobile/otlobha_captain` — **تطبيق اطلبها كابتن للطيارين والسائقين** (التسجيل ورفع الـ 9 مستندات بالكاميرا، زر التفرغ المشروط باعتماد الإدارة، تنفيذ طلبات المتاجر وتأكيد الطرود بـ OTP، متابعة حد الكاش، طلبات التسوية، وصندوق إشعارات الإدارة).

## خطوات التشغيل وبناء نسخ Android / iOS على جهازك
1. تأكد من تثبيت **Flutter SDK** (`flutter --version`).
2. لتشغيل **تطبيق العميل** على المحاكي أو الهاتف:
   ```bash
   cd mobile/otlobha_customer
   flutter create . --platforms=android,ios
   flutter pub get
   flutter run
   ```
3. لتشغيل **تطبيق الطيارين (الكابتن)**:
   ```bash
   cd mobile/otlobha_captain
   flutter create . --platforms=android,ios
   flutter pub get
   flutter run
   ```
4. لتغيير رابط السيرفر عند البناء للإنتاج:
   ```bash
   flutter build apk --release --dart-define=API_BASE_URL=https://YOUR_PRODUCTION_DOMAIN
   ```
   أو تشغيل السكربت الموحد لتوليد نسختي العميل والطيارين معًا:
   ```bash
   chmod +x mobile/build_both_apps.sh
   ./mobile/build_both_apps.sh
   ```

## البناء السحابي المجاني بدون تثبيت Flutter على جهازك (GitHub Actions)
تم إعداد ملف `/.github/workflows/build_mobile_apps.yml` لبناء ملفي:
- `otlobha-customer-apk` (تطبيق العميل للأندرويد `.apk`)
- `otlobha-captain-apk` (تطبيق الطيارين للأندرويد `.apk`)
- ونسخة iOS غير موقّعة على مشغّل macOS عند التشغيل اليدوي (`workflow_dispatch`).
بمجرد رفع المشروع إلى مستودع GitHub مجاني، يمكنك تنزيل ملفي الـ APK مباشرةً من تبويب **Actions**.

> **ملاحظة متاجر التطبيقات:** إصدار **Android (`.apk`/`.aab`)** يحتاج حساب Google Play Developer (25$ مرة واحدة)، وإصدار **iOS (`.ipa`)** يتطلب جهاز Mac مع Xcode وحساب Apple Developer (99$ سنويًا).

