import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_customer/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('OtlobhaCustomerApp shows Google Sign-In, Email Link Register, Reset Link, and Guest options', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const OtlobhaCustomerApp());
    await tester.pumpAndSettle();

    expect(find.byType(OtlobhaCustomerApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);

    // Verify Google Sign-In, Login, Register, Forgot Password, and Guest entry points
    expect(find.text('المتابعة باستخدام حساب جوجل'), findsOneWidget);
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('إنشاء حساب جديد'), findsOneWidget);
    expect(find.text('هل نسيت كلمة المرور؟'), findsOneWidget);
    expect(find.text('الدخول كزائر'), findsOneWidget);

    // Switch to Register mode (link-based, no OTP code)
    final registerTab = find.text('إنشاء حساب جديد');
    await tester.ensureVisible(registerTab);
    await tester.pumpAndSettle();
    await tester.tap(registerTab);
    await tester.pumpAndSettle();
    expect(find.text('إرسال رابط تأكيد الحساب'), findsOneWidget);

    // Switch back to Login and open Forgot Password mode (link-based, no OTP code)
    final loginTab = find.text('تسجيل الدخول').first;
    await tester.ensureVisible(loginTab);
    await tester.pumpAndSettle();
    await tester.tap(loginTab);
    await tester.pumpAndSettle();

    final forgotBtn = find.text('هل نسيت كلمة المرور؟');
    await tester.ensureVisible(forgotBtn);
    await tester.pumpAndSettle();
    await tester.tap(forgotBtn);
    await tester.pumpAndSettle();
    expect(find.text('استعادة كلمة المرور'), findsOneWidget);
    expect(find.text('إرسال رابط تغيير كلمة المرور'), findsOneWidget);
  });
}
