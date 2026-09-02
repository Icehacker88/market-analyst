.PHONY: dev test build

dev:
	$(MAKE) -C 股票预测 dev

test:
	$(MAKE) -C 股票预测 test

build:
	$(MAKE) -C 股票预测 build
