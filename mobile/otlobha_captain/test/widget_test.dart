import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otlobha_captain/main.dart';

void main() {
  testWidgets('OtlobhaCaptainApp builds and initializes RTL MaterialApp', (WidgetTester tester) async {
    await tester.pumpWidget(const OtlobhaCaptainApp());

    expect(find.byType(OtlobhaCaptainApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Directionality), findsWidgets);
  });
}
