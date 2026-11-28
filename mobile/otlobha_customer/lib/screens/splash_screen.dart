import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Animated cold-launch splash screen for Otlobha Customer App.
/// Uses the official project logo asset (`assets/images/otlobha_logo.jpg`),
/// plays a lightweight ~2-second sequence (logo scale+fade -> tagline reveal -> smooth fade-out),
/// and invokes [onFinished] automatically without blocking session restoration.
class OtlobhaSplashScreen extends StatefulWidget {
  final VoidCallback onFinished;

  const OtlobhaSplashScreen({
    super.key,
    required this.onFinished,
  });

  @override
  State<OtlobhaSplashScreen> createState() => _OtlobhaSplashScreenState();
}

class _OtlobhaSplashScreenState extends State<OtlobhaSplashScreen>
    with SingleTickerProviderStateMixin {
  static const Color _brandCrimson = Color(0xFFA92224);
  static const Color _brandAmber = Color(0xFFF5A623);
  static const Color _taglineColor = Color(0xFF1E293B);

  late final AnimationController _controller;
  late final Animation<double> _logoOpacity;
  late final Animation<double> _logoScale;
  late final Animation<double> _dividerScaleX;
  late final Animation<double> _dividerOpacity;
  late final Animation<double> _taglineOpacity;
  late final Animation<double> _taglineOffsetY;
  late final Animation<double> _exitOpacity;

  bool _didNotifyFinished = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2100),
    );

    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.34, curve: Curves.easeOut),
      ),
    );

    _logoScale = Tween<double>(begin: 0.82, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.44, curve: Curves.easeOutCubic),
      ),
    );

    _dividerScaleX = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.32, 0.54, curve: Curves.easeOutCubic),
      ),
    );

    _dividerOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.32, 0.50, curve: Curves.easeOut),
      ),
    );

    _taglineOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.36, 0.62, curve: Curves.easeOut),
      ),
    );

    _taglineOffsetY = Tween<double>(begin: 14.0, end: 0.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.36, 0.64, curve: Curves.easeOutCubic),
      ),
    );

    _exitOpacity = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.84, 1.0, curve: Curves.easeInOut),
      ),
    );

    _controller.addStatusListener(_handleAnimationStatus);
    _controller.forward();
  }

  void _handleAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed && !_didNotifyFinished) {
      _didNotifyFinished = true;
      widget.onFinished();
    }
  }

  @override
  void dispose() {
    _controller.removeStatusListener(_handleAnimationStatus);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final reduceMotion = media.disableAnimations;
    final shortestSide = media.size.shortestSide;
    final logoSize = (shortestSide * 0.54).clamp(172.0, 236.0);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: Colors.white,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            final exitAlpha = _exitOpacity.value.clamp(0.0, 1.0);
            final logoAlpha = reduceMotion ? 1.0 : _logoOpacity.value.clamp(0.0, 1.0);
            final logoZoom = reduceMotion ? 1.0 : _logoScale.value;
            final lineAlpha = reduceMotion ? 1.0 : _dividerOpacity.value.clamp(0.0, 1.0);
            final lineScale = reduceMotion ? 1.0 : _dividerScaleX.value;
            final textAlpha = reduceMotion ? 1.0 : _taglineOpacity.value.clamp(0.0, 1.0);
            final textShiftY = reduceMotion ? 0.0 : _taglineOffsetY.value;

            return IgnorePointer(
              ignoring: _controller.value >= 0.84,
              child: Opacity(
                opacity: exitAlpha,
                child: Material(
                  color: Colors.white,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      // Subtle bottom brand warmth while keeping center pure white to seamlessly blend official logo
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: media.size.height * 0.28,
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.bottomCenter,
                                end: Alignment.topCenter,
                                colors: [
                                  _brandCrimson.withOpacity(0.045),
                                  _brandAmber.withOpacity(0.015),
                                  Colors.white.withOpacity(0.0),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      SafeArea(
                        child: Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 28),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Opacity(
                                  opacity: logoAlpha,
                                  child: Transform.scale(
                                    scale: logoZoom,
                                    child: Image.asset(
                                      'assets/images/otlobha_logo.jpg',
                                      width: logoSize,
                                      height: logoSize,
                                      fit: BoxFit.contain,
                                      filterQuality: FilterQuality.high,
                                      semanticLabel: 'شعار اطلبها',
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Opacity(
                                  opacity: lineAlpha,
                                  child: Transform(
                                    alignment: Alignment.center,
                                    transform: Matrix4.diagonal3Values(
                                      lineScale.clamp(0.01, 1.0),
                                      1.0,
                                      1.0,
                                    ),
                                    child: Container(
                                      width: 44,
                                      height: 3,
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(999),
                                        gradient: const LinearGradient(
                                          colors: [_brandAmber, _brandCrimson],
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 14),
                                Opacity(
                                  opacity: textAlpha,
                                  child: Transform.translate(
                                    offset: Offset(0, textShiftY),
                                    child: const Text(
                                      'كل حاجة أقرب ليك',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 19,
                                        fontWeight: FontWeight.w800,
                                        color: _taglineColor,
                                        height: 1.4,
                                        letterSpacing: 0.1,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
