import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_customer/main.dart';

void main() {
  testWidgets('OtlobhaCustomerApp shows Login, Register, Forgot Password, and Guest options', (WidgetTester tester) async {
    await tester.pumpWidget(const OtlobhaCustomerApp());

    expect(find.byType(OtlobhaCustomerApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);

    // Verify all 4 requested entry points exist on the initial auth screen
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('إنشاء حساب جديد'), findsOneWidget);
    expect(find.text('هل نسيت كلمة السر؟'), findsOneWidget);
    expect(find.text('الدخول كزائر'), findsOneWidget);

    // Switch to Register mode
    await tester.tap(find.text('إنشاء حساب جديد'));
    await tester.pump();
    expect(find.text('إرسال رمز تأكيد البريد الإلكتروني'), findsOneWidget);

    // Switch back to Login and open Forgot Password mode
    await tester.tap(find.text('تسجيل الدخول').first);
    await tester.pump();
    await tester.tap(find.text('هل نسيت كلمة السر؟'));
    await tester.pump();
    expect(find.text('استعادة كلمة السر'), findsOneWidget);
    expect(find.text('إرسال رمز الاستعادة إلى البريد'), findsOneWidget);
  });
}
