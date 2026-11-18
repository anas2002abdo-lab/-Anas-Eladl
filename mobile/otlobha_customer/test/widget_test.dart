import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_customer/main.dart';

void main() {
  testWidgets('OtlobhaCustomerApp builds and initializes RTL MaterialApp', (WidgetTester tester) async {
    await tester.pumpWidget(const OtlobhaCustomerApp());

    expect(find.byType(OtlobhaCustomerApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);
  });
}
