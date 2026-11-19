import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_captain/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('OtlobhaCaptainApp builds and initializes RTL MaterialApp', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const OtlobhaCaptainApp());
    await tester.pump();

    expect(find.byType(OtlobhaCaptainApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);
  });
}
