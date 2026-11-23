import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_merchant/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('OtlobhaMerchantApp builds and initializes RTL MaterialApp', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const OtlobhaMerchantApp());
    await tester.pump();

    expect(find.byType(OtlobhaMerchantApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);
  });
}
