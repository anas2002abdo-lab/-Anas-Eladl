import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_customer/core/api_client.dart';
import 'package:otlobha_customer/main.dart';
import 'package:otlobha_customer/screens/splash_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('Cold launch displays animated OtlobhaSplashScreen then transitions to Login for new users', (WidgetTester tester) async {
    CustomerShell.resetColdSplashForTest();
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const OtlobhaCustomerApp());
    await tester.pump(const Duration(milliseconds: 200));

    // Splash screen should be visible on cold launch with official logo & tagline
    expect(find.byType(OtlobhaSplashScreen), findsOneWidget);
    expect(find.text('كل حاجة أقرب ليك'), findsOneWidget);

    // After ~2.1s animation finishes, splash dismisses automatically to Login/Register
    await tester.pumpAndSettle();
    expect(find.byType(OtlobhaSplashScreen), findsNothing);
    expect(find.byType(OtlobhaCustomerApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);

    // Verify Google Sign-In, Login, Register, Forgot Password, and Guest entry points
    expect(find.text('المتابعة باستخدام حساب جوجل'), findsOneWidget);
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('إنشاء حساب جديد'), findsOneWidget);
    expect(find.text('هل نسيت كلمة المرور؟'), findsOneWidget);
    expect(find.text('الدخول كزائر'), findsOneWidget);

    // Switch to Register mode (instant registration without prior email verification)
    final registerTab = find.text('إنشاء حساب جديد');
    await tester.ensureVisible(registerTab);
    await tester.pumpAndSettle();
    await tester.tap(registerTab);
    await tester.pumpAndSettle();
    expect(find.text('إنشاء الحساب والدخول فورًا'), findsOneWidget);

    // Verify external verification & forgot-password URI builders
    final api = OtlobhaCustomerApi();
    final verifyUri = api.verifyEmailExternalUri(email: 'Test@Gmail.com', autoSend: true);
    expect(verifyUri.path, '/portal/customer/verify-email');
    expect(verifyUri.queryParameters['email'], 'test@gmail.com');
    expect(verifyUri.queryParameters['auto'], '1');

    final forgotUri = api.forgotPasswordExternalUri(email: 'Test@Gmail.com');
    expect(forgotUri.path, '/portal/customer/forgot-password');
    expect(forgotUri.queryParameters['email'], 'test@gmail.com');
  });

  testWidgets('Cold launch routes returning guest session directly to Home without showing Login', (WidgetTester tester) async {
    CustomerShell.resetColdSplashForTest();
    SharedPreferences.setMockInitialValues({'otlobha_cust_is_guest': true});
    await tester.pumpWidget(const OtlobhaCustomerApp());
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.byType(OtlobhaSplashScreen), findsOneWidget);
    expect(find.text('كل حاجة أقرب ليك'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 2200));
    await tester.pump();
    expect(find.byType(OtlobhaSplashScreen), findsNothing);
    expect(find.text('المتابعة باستخدام حساب جوجل'), findsNothing);
  });
}
