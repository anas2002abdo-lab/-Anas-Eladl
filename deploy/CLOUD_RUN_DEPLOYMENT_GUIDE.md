# دليل النشر الإنتاجي الآمن — Otlobha Unified Backend على Google Cloud Run (`europe-west2`)

يغطي هذا الدليل التجهيز الإنتاجي الكامل لنشر **Otlobha Unified Backend** على **Google Cloud Run (`europe-west2`)** مع:
- حماية سلامة قاعدة بيانات **SQLite** (بدون فتح ملف SQLite مباشرة على Cloud Storage FUSE).
- حفظ جميع الأسرار الحساسة داخل **Google Secret Manager**.
- عدم رفع أو استبدال بيانات الإنتاج تلقائيًا أبدًا دون تأكيد صريح منك.
- الحفاظ الكامل على جميع الواجهات والوظائف وجداول قاعدة البيانات الحالية دون تعديل.

---

## 1. مراجعة أمان SQLite على Cloud Storage FUSE (لماذا لا يكفي `max-instances=1` وحده؟)

فتح قاعدة بيانات SQLite مباشرة على مجلد Cloud Storage FUSE (`/data/otlobha.db`) يشكّل **مخاطر حقيقية لتلف أو فقدان البيانات** حتى مع `max-instances=1`، للأسباب التالية:
1. **Cloud Storage ليس نظام ملفات POSIX حقيقيًا**: لا يدعم أقفال النطاقات (`fcntl` byte-range locks) ولا الكتابة العشوائية الذرية (`fsync` لصفحات 4KB)، مما قد يسبب كتابة غير مكتملة أو أخطاء `EIO`.
2. **تداخل الإصدارات أثناء النشر (Revision Overlap)**: حتى مع `--max-instances=1`، قد يعمل الإصدار القديم والجديد لثوانٍ معًا أثناء التبديل، وإذا فتح كلاهما نفس ملف FUSE مباشرة سيحدث تعارض كتابة وفقدان بيانات.
3. **الإنهاء المفاجئ (`SIGTERM`)**: إغلاق الحاوية أثناء وجود ملف SQLite مفتوح مباشرة على FUSE قد يمنع تفريغ التعديلات.

### الحل الآمن المُطبّق الآن (بدون تغيير أي جدول أو منطق أعمال):
1. **تشغيل SQLite على القرص المحلي السريع داخل الحاوية (`/tmp/otlobha-local/otlobha.db`)**:
   - يعمل في وضع **`WAL`** الكامل مع **`PRAGMA synchronous = FULL`** و**`busy_timeout = 10000`** (دعم POSIX كامل بدون أي كتابة عشوائية على FUSE).
2. **مزامنة لقطات ذرية مُتحقق من سلامتها إلى GCS (`/mnt/gcs-data`)** (`src/server/sqlitePersist.ts`):
   - **عند الإقلاع (Hydration)**: ينسخ `otlobha.db` من `/mnt/gcs-data` إلى القرص المحلي، ويفحص ترويسة SQLite و`PRAGMA integrity_check = ok` قبل التشغيل؛ وإذا اكتشف أي تلف **يرفض الإقلاع بصوت واضح بدل الكتابة فوق بيانات الإنتاج بقاعدة فارغة**.
   - **أثناء التشغيل**: يراقب تغييرات الكتابة فقط (`total_changes` + `data_version`)، وعند حدوث تعديلات ينشئ لقطة متسقة عبر `db.backup()`، يحوّلها لملف واحد (`DELETE`)، يتحقق من `integrity_check = ok` و`SHA-256`، ثم يستبدل `/mnt/gcs-data/otlobha.db` بشكل ذري (`staging -> rename`).
   - **لقطات دورية تلقائية + Object Versioning**: يحفظ نسخًا دورية داخل `backups/` كل 30 دقيقة عند وجود تعديلات، مع تفعيل **GCS Object Versioning** (الاحتفاظ بآخر 30 نسخة غير قابلة للتعديل) للاسترجاع الفوري لأي نقطة زمنية.
   - **إغلاق آمن (`SIGTERM` / `SIGINT`)**: يوقف استقبال الطلبات الجديدة ثم يفرّغ لقطة نهائية مُتحقق منها إلى `/mnt/gcs-data/otlobha.db` قبل إغلاق SQLite.

### الحدود المتبقية التي يجب معرفتها بشفافية:
- يظل الخادم مقيدًا بنسخة واحدة (`--max-instances=1`) لأن SQLite كاتب واحد.
- في حالة تعطل مفاجئ جدًا (OOM / `SIGKILL` فوري دون `SIGTERM`) قد تُفقد التعديلات التي حدثت خلال آخر ~15 ثانية قبل آخر مزامنة (RPO ≤ 15s).
- أثناء نشر إصدار جديد (`gcloud run deploy`) يُنصح بالترقية في وقت هدوء مروري لتقليل نافذة التداخل بين الإصدار القديم والجديد.
- للتوسع الأفقي متعدد النسخ مستقبلًا بدون نافذة RPO، يكون المسار الطبيعي لاحقًا هو **Cloud SQL (PostgreSQL)**.

---

## 2. إنشاء النسخة الاحتياطية والتحقق من قابليتها للاسترجاع (محليًا فقط)

```bash
# إنشاء نسخة احتياطية كاملة في ملف واحد + بصمة SHA-256 + تقرير الجداول والصفوف
npx tsx scripts/checkpoint-sqlite.ts

# التحقق من سلامة النسخة وبصمتها وإمكانية استرجاعها
npx tsx scripts/checkpoint-sqlite.ts --verify .backups/<backup-file-name>.db
```

> لا يتم رفع هذه النسخة أو استبدال قاعدة الإنتاج تلقائيًا أبدًا.

---

## 3. الخطوات التي تتطلب صلاحياتك وموافقتك في Google Cloud

### الخطوة أ: تهيئة الصلاحيات والأسرار في Google Secret Manager (مرة واحدة في Cloud Shell)
افتح **Google Cloud Shell** في مشروعك ونفّذ:
```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export REGION="europe-west2"

chmod +x deploy/setup_gcp_secrets.sh deploy/restore_sqlite_to_gcs.sh deploy/deploy_cloud_run.sh
./deploy/setup_gcp_secrets.sh
```
سيقوم السكربت بالتالي:
- تفعيل الخدمات: `run`, `cloudbuild`, `artifactregistry`, `storage`, `secretmanager`.
- إنشاء حساب خدمة مخصص بأقل صلاحيات (`otlobha-backend-runner`).
- إنشاء Bucket التخزين في `europe-west2` مع تفعيل **Object Versioning** والاحتفاظ بآخر 30 نسخة.
- تخزين الأسرار الحساسة في **Google Secret Manager** (إدخال مخفي بدون طباعة):
  - `otlobha-smtp-pass`
  - `otlobha-jwt-access-secret`
  - `otlobha-jwt-refresh-secret`
  - `otlobha-super-admin-password`
  - `otlobha-gemini-api-key` *(اختياري)*

### الخطوة ب (اختيارية — فقط عند رغبتك في نقل بياناتك الحالية أول مرة)
```bash
./deploy/restore_sqlite_to_gcs.sh .backups/<your-verified-backup>.db
```
- يتحقق أولًا من بصمة `SHA-256` و`PRAGMA integrity_check`.
- يطلب منك تأكيدًا صريحًا (`YES`) عند الرفع الأول، ويرفض استبدال أي قاعدة بيانات موجودة إلا بتمرير `--allow-overwrite` وكتابة `REPLACE PRODUCTION DB` بعد أرشفة النسخة الحالية تلقائيًا في `pre-restore-backups/`.

### الخطوة ج: النشر الفعلي على Google Cloud Run (`europe-west2`)
حدّد الإعدادات غير السرية فقط ثم نفّذ سكربت النشر:
```bash
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="465"
export SMTP_SECURE="true"
export SMTP_USER="your-gmail@gmail.com"
export SMTP_FROM="Otlobha اطلبها <your-gmail@gmail.com>"
export SUPER_ADMIN_EMAIL="admin@otlobha.eg"
export SUPER_ADMIN_NAME="مدير منظومة اطلبها"
export MIN_INSTANCES="0" # أو 1 لإبقاء الخادم دافئًا دائمًا

./deploy/deploy_cloud_run.sh
```
سيطبع لك الرابط العام النهائي (`https://otlobha-backend-xxxx-nw.a.run.app`) ويتحقق تلقائيًا من `GET /api/health` و`GET /api/mobile/customer/guest-bootstrap`.

### الخطوة د (بديل عبر GitHub Actions — تشغيل يدوي `workflow_dispatch`)
أضف في إعدادات GitHub:
- **Repository Secrets**:
  - `GCP_PROJECT_ID`
  - إما `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_DEPLOYER_SA` *(موصى به)*، أو `GCP_SA_KEY`
- **Repository Variables (غير سرية)**:
  - `SMTP_HOST` (`smtp.gmail.com`), `SMTP_PORT` (`465`), `SMTP_SECURE` (`true`), `SMTP_USER`, `SMTP_FROM`
  - `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`
  - (بعد أول نشر) `OTLOBHA_API_BASE_URL` = رابط Cloud Run العام لربط تطبيقي Flutter.

ثم شغّل Workflow: **Deploy Otlobha Backend to Cloud Run**.
